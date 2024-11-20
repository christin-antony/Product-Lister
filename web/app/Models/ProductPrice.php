<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductPrice extends Model
{

    protected $table = 'product_price_history';

    protected $fillable = [
        'shop_id',
        'variant_id',
        'product_id',
        'product_title',
        'current_price',
        'price_history'
    ];

    protected $casts = [
        'price_history' => 'array'
    ];
}
