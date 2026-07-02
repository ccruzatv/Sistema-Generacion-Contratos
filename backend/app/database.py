import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv(Path(__file__).parent.parent / ".env")

_env = os.getenv("DB_ENV", "local").lower()

if _env == "local":
    # Ambiente abierto para pruebas en localhost: SQLite en archivo local,
    # sin credenciales ni acceso a la red PJUD.
    _db_path = os.getenv("LOCAL_DB_PATH", str(Path(__file__).parent.parent / "local.db"))
    SQLALCHEMY_DATABASE_URL = f"sqlite:///{_db_path}"
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    if _env == "test":
        _host = os.getenv("ORACLE_TEST_HOST", "unextest.bdd.pjud")
        _port = os.getenv("ORACLE_TEST_PORT", "1615")
        _service = os.getenv("ORACLE_TEST_SERVICE", "UNEXTEST")
        _user = os.getenv("ORACLE_TEST_USER", "SISTMC")
        _password = os.getenv("ORACLE_TEST_PASS", "")
    else:
        _host = os.getenv("ORACLE_DESA_HOST", "unexdesa.bdd.pjud")
        _port = os.getenv("ORACLE_DESA_PORT", "1603")
        _service = os.getenv("ORACLE_DESA_SERVICE", "UNEXDESA")
        _user = os.getenv("ORACLE_DESA_USER", "SISTMC")
        _password = os.getenv("ORACLE_DESA_PASS", "")

    SQLALCHEMY_DATABASE_URL = (
        f"oracle+oracledb://{_user}:{_password}@{_host}:{_port}/?service_name={_service}"
    )

    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
