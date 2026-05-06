from fastapi import FastAPI  # type: ignore
from fastapi.staticfiles import StaticFiles  # type: ignore

from app.routes.api import router as api_router
from app.routes.pages import router as page_router
from app.routes.shared import static_path


app = FastAPI(title="SOFA Frontend")
app.mount("/static", StaticFiles(directory=static_path), name="static")
app.include_router(page_router)
app.include_router(api_router)
