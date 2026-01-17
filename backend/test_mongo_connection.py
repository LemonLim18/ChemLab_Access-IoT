import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from datetime import datetime

# Load environment variables
load_dotenv()

async def test_mongo():
    # Get URI from env or default to local
    mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    print(f"Connecting to MongoDB at: {mongo_uri}")
    
    try:
        # Connect
        client = AsyncIOMotorClient(mongo_uri)
        db = client.chemlab
        collection = db.telemetry
        
        # Create sample data
        sample_data = {
            "temperature_celsius": 24.5,
            "humidity_percent": 45.2,
            "timestamp": datetime.now().isoformat(),
        }
        
        print(f"Attempting to insert: {sample_data}")
        
        # Insert
        result = await collection.insert_one(sample_data)
        
        if result.inserted_id:
            print(f"SUCCESS: Document inserted with ID: {result.inserted_id}")
            
            # Verify by reading back
            saved_doc = await collection.find_one({"_id": result.inserted_id})
            print(f"Verified saved document: {saved_doc}")
        else:
            print("FAILED: No ID returned after insert")
            
    except Exception as e:
        print(f"ERROR: Failed to connect or write to MongoDB: {e}")
        print("Check your MONGO_URI and ensure the database is reachable.")

if __name__ == "__main__":
    # Run the async test
    asyncio.run(test_mongo())
