"""Router package — exports individual routers for main app.include_router()."""
from . import auth, catalog, trucks, shipments, quotes, bookings, location, ratings, earnings, pay, chat, admin

__all__ = [
    "auth", "catalog", "trucks", "shipments", "quotes", "bookings",
    "location", "ratings", "earnings", "pay", "chat", "admin",
]
