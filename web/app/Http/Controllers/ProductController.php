<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use GuzzleHttp\Client;
use App\Models\Session;
use App\Models\ProductPrice;
use Illuminate\Support\Facades\DB;

class ProductController extends Controller
{
    private function createClient($shop, $accessToken)
    {
        $baseUri = "https://{$shop}/admin/api/2024-01/";
        return new Client([
            'base_uri' => $baseUri,
            'headers' => [
                'Content-Type' => 'application/json',
                'X-Shopify-Access-Token' => $accessToken,
            ],
        ]);
    }

    private function storeAllProductVariants($domain, $product)
    {
        foreach ($product['variants'] as $variant) {
            $existingPrice = ProductPrice::where('shop_id', $domain)
                ->where('variant_id', $variant['id'])
                ->first();

            if ($existingPrice) {
                if ($existingPrice->current_price != $variant['price']) {
                    $existingPrice->update([
                        'product_title' => $product['title'],
                        'current_price' => $variant['price']
                    ]);
                }
            } else {
             
                ProductPrice::create([
                    'shop_id' => $domain,
                    'variant_id' => $variant['id'],
                    'product_id' => $product['id'],
                    'product_title' => $product['title'],
                    'current_price' => $variant['price'],
                    'price_history' => [$variant['price']] 
                ]);
            }
        }
    }
    public function getProducts(Request $request)
    {     
        $session = $request->get('shopifySession');
        $domain = $session->getShop();
        $accessToken = $session->getAccessToken();

        $shop = Session::where('shop', $domain)
            ->where('access_token', $accessToken)
            ->first();

        if (!$shop) {
            return response()->json(['error' => 'Session not found'], 404);
        }

        $client = $this->createClient($domain, $accessToken);

        try {
            $response = $client->get("products.json");
            $result = json_decode($response->getBody(), true);
            
            $products = $result['products'] ?? [];
            
           
            DB::beginTransaction();
            try {
                foreach ($products as $product) {
                    $this->storeAllProductVariants($domain, $product);
                }
                DB::commit();
            } catch (\Exception $e) {
                DB::rollBack();
                Log::error("Error storing product data: " . $e->getMessage());
            }

            
            $productPrices = ProductPrice::where('shop_id', $domain)->get()
                ->keyBy('variant_id');
            
            
            foreach ($products as &$product) {
                foreach ($product['variants'] as &$variant) {
                    $priceRecord = $productPrices->get($variant['id']);
                    if ($priceRecord) {
                        $priceHistory = $priceRecord->price_history ?? [];
                        $variant['old_price'] = end($priceHistory) ?: null;
                        $variant['price_history'] = $priceHistory;
                    }
                }
            }

            return response()->json([
                'products' => $products
            ], 200);

        } catch (\Exception $e) {
            Log::error("Error fetching products: " . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => "Error fetching products: " . $e->getMessage(),
            ], 500);
        }
    }


    public function adjustPrices(Request $request)
    {
        $request->validate([
            'productIds' => 'required|array',
            'productIds.*' => 'required|string',
            'percentage' => 'required|numeric|min:0',
            'adjustmentType' => 'required|in:up,down'
        ]);

        $session = $request->get('shopifySession');
        $domain = $session->getShop();
        $accessToken = $session->getAccessToken();

        $shop = Session::where('shop', $domain)
            ->where('access_token', $accessToken)
            ->first();

        if (!$shop) {
            return response()->json(['error' => 'Session not found'], 404);
        }

        $client = $this->createClient($domain, $accessToken);
        $successCount = 0;
        $errorCount = 0;
        $errors = [];

        DB::beginTransaction();
        
        try {
            foreach ($request->productIds as $productId) {
                $response = $client->get("products/{$productId}.json");
                $product = json_decode($response->getBody(), true)['product'];

                foreach ($product['variants'] as $variant) {
                    $currentPrice = floatval($variant['price']);
                    $adjustmentFactor = $request->percentage / 100;
                    
                    $newPrice = $request->adjustmentType === 'up' 
                        ? $currentPrice * (1 + $adjustmentFactor)
                        : $currentPrice * (1 - $adjustmentFactor);

                    $newPrice = round($newPrice, 2);
                    
                    
                    $variantUpdateResponse = $client->put("variants/{$variant['id']}.json", [
                        'json' => [
                            'variant' => [
                                'id' => $variant['id'],
                                'price' => $newPrice
                            ]
                        ]
                    ]);

                    if ($variantUpdateResponse->getStatusCode() === 200) {
                        
                        $priceRecord = ProductPrice::where('shop_id', $domain)
                            ->where('variant_id', $variant['id'])
                            ->first();

                        if ($priceRecord) {
                            
                            $priceHistory = $priceRecord->price_history ?? [];
                            
                            $priceHistory[] = $currentPrice;

                            
                            $priceRecord->update([
                                'current_price' => $newPrice,
                                'price_history' => $priceHistory
                            ]);
                        } else {
                            
                            ProductPrice::create([
                                'shop_id' => $domain,
                                'variant_id' => $variant['id'],
                                'product_id' => $product['id'],
                                'product_title' => $product['title'],
                                'current_price' => $newPrice,
                                'price_history' => [$currentPrice]
                            ]);
                        }

                        $successCount++;
                    } else {
                        $errorCount++;
                        $errors[] = "Failed to update variant {$variant['id']} of product {$productId}";
                    }
                }
            }

            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }

        return response()->json([
            'success' => $errorCount === 0,
            'summary' => [
                'total_processed' => count($request->productIds),
                'successful_updates' => $successCount,
                'failed_updates' => $errorCount
            ],
            'errors' => $errors
        ], $errorCount === 0 ? 200 : 207);
    }


    public function undoPriceChanges(Request $request)
    {
        $request->validate([
            'productIds' => 'required|array',
            'productIds.*' => 'required|string',
            'steps' => 'required|integer|min:1'
        ]);

        $session = $request->get('shopifySession');
        $domain = $session->getShop();
        $accessToken = $session->getAccessToken();

        $client = $this->createClient($domain, $accessToken);
        $successCount = 0;
        $errorCount = 0;
        $errors = [];

        DB::beginTransaction();
        
        try {
            foreach ($request->productIds as $productId) {
                $response = $client->get("products/{$productId}.json");
                $product = json_decode($response->getBody(), true)['product'];

                foreach ($product['variants'] as $variant) {
                    
                    $priceRecord = ProductPrice::where('shop_id', $domain)
                        ->where('variant_id', $variant['id'])
                        ->first();

                    if ($priceRecord && !empty($priceRecord->price_history)) {
                        $priceHistory = $priceRecord->price_history;
                        
                       
                        $stepsToUndo = min(count($priceHistory), $request->steps);
                        
                        if ($stepsToUndo > 0) {
                           
                            $targetPrice = $priceHistory[count($priceHistory) - $stepsToUndo];
                            
                           
                            $variantUpdateResponse = $client->put("variants/{$variant['id']}.json", [
                                'json' => [
                                    'variant' => [
                                        'id' => $variant['id'],
                                        'price' => $targetPrice
                                    ]
                                ]
                            ]);

                            if ($variantUpdateResponse->getStatusCode() === 200) {
                                
                                array_splice($priceHistory, -$stepsToUndo);
                                
                               
                                $priceRecord->update([
                                    'current_price' => $targetPrice,
                                    'price_history' => $priceHistory
                                ]);

                                $successCount++;
                            } else {
                                $errorCount++;
                                $errors[] = "Failed to update variant {$variant['id']} of product {$productId}";
                            }
                        }
                    }
                }
            }

            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }

        return response()->json([
            'success' => $errorCount === 0,
            'summary' => [
                'total_processed' => count($request->productIds),
                'successful_updates' => $successCount,
                'failed_updates' => $errorCount,
                'steps_undone' => $request->steps
            ],
            'errors' => $errors
        ], $errorCount === 0 ? 200 : 207);
    }
}