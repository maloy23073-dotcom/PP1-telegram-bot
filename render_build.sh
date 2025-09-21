#!/bin/bash
echo "=== Starting Build Process ==="

echo "1. Updating pip..."
python -m pip install --upgrade pip

echo "2. Installing core dependencies..."
pip install fastapi==0.104.1 uvicorn[standard]==0.24.0
pip install python-telegram-bot==20.7 apscheduler==3.10.4
pip install aiohttp==3.9.3 python-dotenv==1.0.0

echo "3. Attempting to install psycopg2-binary..."
pip install psycopg2-binary==2.9.8 || echo "psycopg2-binary installation failed - continuing without database"

echo "4. Build completed successfully!"
echo "=== Ready to start server ==="