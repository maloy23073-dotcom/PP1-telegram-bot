import os
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

def init_database():
    DATABASE_URL = os.environ.get("DATABASE_URL")
    if not DATABASE_URL:
        print("DATABASE_URL environment variable is not set")
        return False
    
    try:
        # Подключаемся к базе данных
        conn = psycopg2.connect(DATABASE_URL, sslmode='require')
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        
        # Создаем таблицу если не существует
        cur.execute("""
            CREATE TABLE IF NOT EXISTS calls (
                id SERIAL PRIMARY KEY,
                code VARCHAR(6) UNIQUE NOT NULL,
                creator_id BIGINT NOT NULL,
                start_ts INTEGER NOT NULL,
                duration_min INTEGER NOT NULL,
                created_ts INTEGER NOT NULL,
                active BOOLEAN DEFAULT TRUE
            )
        """)
        
        print("Database table created successfully")
        cur.close()
        conn.close()
        return True
        
    except Exception as e:
        print(f"Error initializing database: {e}")
        return False

if __name__ == "__main__":
    init_database()