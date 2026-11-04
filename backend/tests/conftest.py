from pathlib import Path
import shutil

import pytest

from app.db import Database
from app.services import Service


@pytest.fixture(scope="session")
def seeded_database(tmp_path_factory):
    path = tmp_path_factory.mktemp("baseline") / "seed.sqlite3"
    Service(Database(path))
    return path


@pytest.fixture
def service(tmp_path, seeded_database):
    path = Path(tmp_path) / "test.sqlite3"
    shutil.copyfile(seeded_database, path)
    return Service(Database(path))


@pytest.fixture
def users(service):
    with service.db.connect() as cx:
        return {row["id"]: dict(row) for row in cx.execute("SELECT * FROM users")}
