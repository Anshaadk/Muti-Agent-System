"""
Multi-Agent Research System — FastAPI backend

Flow:
  POST /api/chat          → classify message → chat reply OR ask user to confirm deep research
  POST /api/research/stream → run full 4-agent pipeline (SSE)
  POST /api/simple        → simple LLM reply (no pipeline)
  DELETE /api/memory      → clear ChromaDB session memory
  GET  /api/health        → health check
"""

import asyncio
import json
import os
import sys
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

# ── App ────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Multi-Agent Research System",
    description="Smart chat + deep research pipeline with ChromaDB memory",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_api_exception(request: Request, exc: Exception):
    message = str(exc).strip()
    lowered = message.lower()
    if "api key" in lowered or "api_key" in lowered or "token" in lowered:
        message = "The AI provider API key or token is missing or invalid. Please configure it and try again."
    elif "empty response" in lowered:
        message = message
    else:
        message = "The request could not be completed. Please check the AI provider connection and try again."
    return JSONResponse(
        status_code=500,
        content={"detail": message},
    )

# ── Lazy LLM (shared across routes) ───────────────────────────────────────
_llm = None

def get_llm():
    global _llm
    if _llm is None:
        from langchain_groq.chat_models import ChatGroq
        _llm = ChatGroq(model="openai/gpt-oss-120b")
    return _llm


# ── Schemas ────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"

class SimpleRequest(BaseModel):
    message: str
    session_id: str = "default"

class ResearchRequest(BaseModel):
    topic: str
    session_id: str = "default"

class ClearMemoryRequest(BaseModel):
    session_id: str = "default"


# ── SSE helper ─────────────────────────────────────────────────────────────
def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _text_from_result(result, label: str) -> str:
    """Normalize LangChain message/agent output and reject empty completions."""
    if isinstance(result, dict):
        messages = result.get("messages") or []
        content = messages[-1].content if messages and hasattr(messages[-1], "content") else None
        if not content:
            content = result.get("output") or result.get("content")
    else:
        content = getattr(result, "content", result)

    if isinstance(content, list):
        content = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    text = str(content or "").strip()
    if not text:
        raise RuntimeError(f"{label} returned an empty response. Please try again or check the AI provider token.")
    return text


# ── /api/chat  (classify → chat reply OR prompt for deep research) ─────────
@app.post("/api/chat")
async def chat(req: ChatRequest):
    """
    Classify the user message.
    - If it looks conversational / simple → reply immediately.
    - If it looks like a research topic → return needs_research=True so the
      frontend can ask the user whether they want the deep pipeline.
    """
    from memory import save_turn, get_relevant_history
    from langchain_core.messages import SystemMessage, HumanMessage

    msg = req.message.strip()
    if not msg:
        raise HTTPException(status_code=422, detail="Message must not be empty.")

    llm = get_llm()

    # ── Step 1: classify ────────────────────────────────────────────────────
    classify_prompt = (
        "You are a router. Decide if the user's message requires deep web research "
        "(news, detailed facts, current events, scientific topics, comparisons, how-to guides) "
        "or if a direct conversational reply is enough (greetings, simple questions, opinions, "
        "small talk, definitions, basic facts).\n\n"
        f'User message: "{msg}"\n\n'
        'Reply with exactly one word: "research" or "chat".'
    )
    classification = await asyncio.to_thread(
        llm.invoke,
        [HumanMessage(content=classify_prompt)],
    )
    intent = _text_from_result(classification, "Request classifier").lower()
    needs_research = "research" in intent

    if needs_research:
        # Don't run the pipeline yet — let the frontend ask the user first
        save_turn("user", msg, req.session_id)
        return {
            "type": "confirm_research",
            "message": (
                f'This looks like a research topic. '
                f'Do you want me to run a **deep research** pipeline on "{msg}"? '
                f'It will search the web, scrape sources, write a report and critique it.'
            ),
            "topic": msg,
        }

    # ── Step 2: chat reply with memory context ──────────────────────────────
    history = get_relevant_history(msg, req.session_id, n=6)

    messages = [
        SystemMessage(content=(
            "You are a helpful, concise AI assistant. "
            "Use the conversation history below for context when relevant.\n\n"
            + "\n".join(f"{h['role'].upper()}: {h['content']}" for h in history)
            if history else
            "You are a helpful, concise AI assistant."
        ))
    ]
    messages.append(HumanMessage(content=msg))

    reply = await asyncio.to_thread(llm.invoke, messages)
    response_text = _text_from_result(reply, "Chat assistant")

    # Persist both turns
    save_turn("user",      msg,           req.session_id)
    save_turn("assistant", response_text, req.session_id)

    return {"type": "chat", "message": response_text}


# ── /api/simple  (user chose No to deep research) ──────────────────────────
@app.post("/api/simple")
async def simple_reply(req: SimpleRequest):
    """Return a plain LLM answer without running the research pipeline."""
    from memory import save_turn, get_relevant_history
    from langchain_core.messages import SystemMessage, HumanMessage

    msg = req.message.strip()
    if not msg:
        raise HTTPException(status_code=422, detail="Message must not be empty.")

    llm = get_llm()
    history = get_relevant_history(msg, req.session_id, n=6)

    messages = [
        SystemMessage(content=(
            "You are a knowledgeable AI assistant. Give a clear, well-structured answer. "
            "Use the conversation history below for context when relevant.\n\n"
            + "\n".join(f"{h['role'].upper()}: {h['content']}" for h in history)
            if history else
            "You are a knowledgeable AI assistant. Give a clear, well-structured answer."
        ))
    ]
    messages.append(HumanMessage(content=msg))

    reply = await asyncio.to_thread(llm.invoke, messages)
    response_text = _text_from_result(reply, "Quick answer assistant")

    save_turn("user",      msg,           req.session_id)
    save_turn("assistant", response_text, req.session_id)

    return {"type": "simple", "message": response_text}


# ── /api/research/stream  (full pipeline, SSE) ─────────────────────────────
async def _run_pipeline(topic: str, session_id: str):
    from agents import build_search_agent, build_reader_agent, writer_chain, critic_chain
    from memory import save_turn

    state: dict = {}
    pipeline_started = time.perf_counter()

    # Step 1 — Search
    yield sse("step", {"step": 1, "title": "Search Agent", "status": "running",
                        "message": "Searching the web for relevant information…"})
    await asyncio.sleep(0)

    search_agent = build_search_agent()
    step_started = time.perf_counter()
    sr = await asyncio.to_thread(
        search_agent.invoke,
        {"messages": [("user", f"Find recent, reliable and detailed information about: {topic}")]},
    )
    state["search_result"] = _text_from_result(sr, "Search agent")
    yield sse("step", {"step": 1, "title": "Search Agent", "status": "done",
                        "message": "Search complete.", "content": state["search_result"],
                        "duration_ms": round((time.perf_counter() - step_started) * 1000)})
    await asyncio.sleep(0)

    # Step 2 — Reader
    yield sse("step", {"step": 2, "title": "Reader Agent", "status": "running",
                        "message": "Scraping the most relevant URL…"})
    await asyncio.sleep(0)

    reader_agent = build_reader_agent()
    step_started = time.perf_counter()
    rr = await asyncio.to_thread(
        reader_agent.invoke,
        {"messages": [("user",
            f"Based on the following search results about '{topic}', "
            f"pick the most relevant URL and scrape it for deeper content.\n\n"
            f"Search Results:\n{state['search_result'][:800]}"
        )]},
    )
    state["scraped_content"] = _text_from_result(rr, "Reader agent")
    yield sse("step", {"step": 2, "title": "Reader Agent", "status": "done",
                        "message": "Scraping complete.", "content": state["scraped_content"],
                        "duration_ms": round((time.perf_counter() - step_started) * 1000)})
    await asyncio.sleep(0)

    # Step 3 — Writer
    yield sse("step", {"step": 3, "title": "Writer", "status": "running",
                        "message": "Drafting the research report…"})
    await asyncio.sleep(0)

    compiled = (
        f"SEARCHED RESULTS: {state['search_result']}\n\n"
        f"DETAILED SCRAPED CONTENT: {state['scraped_content']}\n\n"
    )
    step_started = time.perf_counter()
    state["report"] = await asyncio.to_thread(
        writer_chain.invoke, {"topic": topic, "research": compiled},
    )
    state["report"] = _text_from_result(state["report"], "Writer agent")
    yield sse("step", {"step": 3, "title": "Writer", "status": "done",
                        "message": "Report drafted.", "content": state["report"],
                        "duration_ms": round((time.perf_counter() - step_started) * 1000)})
    await asyncio.sleep(0)

    # Step 4 — Critic
    yield sse("step", {"step": 4, "title": "Critic", "status": "running",
                        "message": "Reviewing and scoring the report…"})
    await asyncio.sleep(0)

    step_started = time.perf_counter()
    state["feedback"] = await asyncio.to_thread(
        critic_chain.invoke, {"report": state["report"]},
    )
    state["feedback"] = _text_from_result(state["feedback"], "Critic agent")
    yield sse("step", {"step": 4, "title": "Critic", "status": "done",
                        "message": "Review complete.", "content": state["feedback"],
                        "duration_ms": round((time.perf_counter() - step_started) * 1000)})
    await asyncio.sleep(0)

    # Save summary to memory
    summary = f"Research on '{topic}': {state['report'][:500]}"
    save_turn("user",      topic,   session_id)
    save_turn("assistant", summary, session_id)

    yield sse("result", {
        "topic":           topic,
        "search_result":   state["search_result"],
        "scraped_content": state["scraped_content"],
        "report":          state["report"],
        "feedback":        state["feedback"],
        "duration_ms":     round((time.perf_counter() - pipeline_started) * 1000),
    })
    yield sse("done", {"message": "Pipeline complete."})


@app.post("/api/research/stream")
async def research_stream(req: ResearchRequest):
    """Run the full 4-agent research pipeline, streaming SSE progress."""
    if not req.topic.strip():
        raise HTTPException(status_code=422, detail="Topic must not be empty.")

    async def safe_stream():
        try:
            async for chunk in _run_pipeline(req.topic.strip(), req.session_id):
                yield chunk
        except Exception as exc:
            yield sse("error", {"message": str(exc)})

    return StreamingResponse(
        safe_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── /api/memory  (clear ChromaDB session) ─────────────────────────────────
@app.delete("/api/memory")
async def clear_memory(req: ClearMemoryRequest):
    from memory import clear_session
    deleted = await asyncio.to_thread(clear_session, req.session_id)
    return {"deleted": deleted, "session_id": req.session_id}


# ── /api/health ────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Multi-Agent Research System", "version": "2.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
