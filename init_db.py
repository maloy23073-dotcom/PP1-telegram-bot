import os
import psycopg2
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def init_database():
    DATABASE_URL = os.environ.get("DATABASE_URL")
    if not DATABASE_URL:
        logger.error("DATABASE_URL not set")
        return False

    try:
        conn = psycopg2.connect(DATABASE_URL, sslmode='require')
        cur = conn.cursor()

        cur.execute("""
                    CREATE TABLE IF NOT EXISTS calls
                    (
                        id
                        SERIAL
                        PRIMARY
                        KEY,
                        code
                        VARCHAR
                    (
                        6
                    ) UNIQUE NOT NULL,
                        creator_id BIGINT NOT NULL,
                        start_ts INTEGER NOT NULL,
                        duration_min INTEGER NOT NULL,
                        created_ts INTEGER NOT NULL,
                        active BOOLEAN DEFAULT TRUE
                        )
                    """)

        conn.commit()
        cur.close()
        conn.close()
        logger.info("Database initialized successfully")
        return True

    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        return False


if __name__ == "__main__":
    init_database()