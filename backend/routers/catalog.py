from fastapi import APIRouter
from deps import TRUCK_TYPES, GOODS_CATEGORIES, BODY_TYPES

router = APIRouter(tags=["catalog"])


@router.get("/catalog")
async def catalog():
    return {
        "truck_types": TRUCK_TYPES,
        "goods_categories": GOODS_CATEGORIES,
        "body_types": BODY_TYPES,
    }
