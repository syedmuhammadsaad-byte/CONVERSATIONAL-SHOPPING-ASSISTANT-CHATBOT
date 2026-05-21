import json
import os
from fastapi import APIRouter, HTTPException, Query
from typing import Optional

router = APIRouter(prefix="/products", tags=["products"])

# Load products once at startup
_PRODUCTS_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "products.json")

def load_products():
    with open(_PRODUCTS_PATH, "r") as f:
        return json.load(f)

PRODUCTS = load_products()


@router.get("/", summary="List all products")
def get_products(
    category: Optional[str] = Query(None, description="Filter by category (electronics, clothing, home, sports, beauty)"),
    min_price: Optional[float] = Query(None, ge=0, description="Minimum price"),
    max_price: Optional[float] = Query(None, ge=0, description="Maximum price"),
    brand: Optional[str] = Query(None, description="Filter by brand name"),
    min_rating: Optional[float] = Query(None, ge=0, le=5, description="Minimum rating"),
    in_stock: Optional[bool] = Query(None, description="Only return in-stock items"),
):
    """
    Return all products with optional filters:
    - category, brand, price range, rating, stock status
    """
    results = PRODUCTS

    if category:
        results = [p for p in results if p["category"].lower() == category.lower()]

    if min_price is not None:
        results = [p for p in results if p["price"] >= min_price]

    if max_price is not None:
        results = [p for p in results if p["price"] <= max_price]

    if brand:
        results = [p for p in results if p["brand"].lower() == brand.lower()]

    if min_rating is not None:
        results = [p for p in results if p["rating"] >= min_rating]

    if in_stock is not None:
        if in_stock:
            results = [p for p in results if p["stock"] > 0]
        else:
            results = [p for p in results if p["stock"] == 0]

    return {
        "total": len(results),
        "products": results
    }


@router.get("/{product_id}", summary="Get single product detail")
def get_product(product_id: int):
    """Return a single product by its ID."""
    product = next((p for p in PRODUCTS if p["id"] == product_id), None)
    if not product:
        raise HTTPException(status_code=404, detail=f"Product with id={product_id} not found")
    return product