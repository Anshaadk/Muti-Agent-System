"""
ChromaDB-backed conversation memory.

Each message is stored as an embedding so we can retrieve the most
relevant past turns to provide context for the current request.
"""

import uuid
import chromadb
from chromadb.utils.embedding_functions import DefaultEmbeddingFunction

# Persistent local DB stored next to this file
_client = chromadb.PersistentClient(path="./.chroma_db")

# One collection holds all conversation turns
_collection = _client.get_or_create_collection(
    name="conversation_memory",
    embedding_function=DefaultEmbeddingFunction(),
)


def save_turn(role: str, content: str, session_id: str = "default") -> None:
    """Persist a single message turn to ChromaDB."""
    _collection.add(
        documents=[content],
        metadatas=[{"role": role, "session_id": session_id}],
        ids=[str(uuid.uuid4())],
    )


def get_relevant_history(query: str, session_id: str = "default", n: int = 6) -> list[dict]:
    """
    Retrieve the n most semantically relevant past turns for this query.
    Returns a list of dicts with keys: role, content.
    """
    count = _collection.count()
    if count == 0:
        return []

    results = _collection.query(
        query_texts=[query],
        n_results=min(n, count),
        where={"session_id": session_id},
    )

    history = []
    docs      = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas",  [[]])[0]

    for doc, meta in zip(docs, metadatas):
        history.append({"role": meta.get("role", "user"), "content": doc})

    return history


def clear_session(session_id: str = "default") -> int:
    """Delete all turns for a session. Returns the number of deleted items."""
    results = _collection.get(where={"session_id": session_id})
    ids = results.get("ids", [])
    if ids:
        _collection.delete(ids=ids)
    return len(ids)
