<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ProductController;

Route::middleware(['shopify.auth'])->group(function () {
    Route::get('/products', [ProductController::class, 'getProducts']);
    Route::post('/adjust-price', [ProductController::class, 'adjustPrices']);
    Route::post('/undo-price-changes', [ProductController::class, 'undoPriceChanges']);
});