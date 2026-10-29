# Multi-Agent Research System

A full-stack AI research application that combines conversational chat with a
four-agent deep research pipeline. The React interface provides chat history,
real-time agent progress, execution timings, research reports, source content,
and critic feedback.

## Features

- Conversational AI chat with session memory
- Automatic detection of research-related requests
- Optional quick-answer mode and forced deep research mode
- Four-agent research pipeline with live SSE progress
- Search, source scraping, report writing, and critic review
- Real-time pipeline and individual-agent execution times
- ChromaDB conversation memory with per-session clearing
- Clean, responsive React interface with Markdown-style response rendering
- Local chat history stored in the browser

## Research Pipeline

1. **Search Agent** searches the web through Tavily and returns relevant sources.
2. **Reader Agent** selects a useful source and extracts readable page content.
3. **Writer Agent** combines the collected evidence into a structured report.
4. **Critic Agent** evaluates the report and assigns a quality score.

The pipeline streams each stage to the frontend through Server-Sent Events at
`POST /api/research/stream`.

## Technology Stack

### Backend

- Python 3.14+
- FastAPI
- LangChain
- Groq / ChatGroq
- Tavily Search
- Beautiful Soup
- ChromaDB
- Uvicorn

### Frontend

- React 19
- Vite 8
- JavaScript and CSS
- Local storage for chat history

## Project Structure

```text
MutiAgentSystem/
├── app.py              # FastAPI API and SSE research pipeline
├── agents.py           # Search, reader, writer, and critic agents
├── pipline.py          # Standalone terminal pipeline
├── tools.py            # Tavily search and webpage scraper tools
├── memory.py           # ChromaDB conversation memory
├── pyproject.toml      # Python dependencies
└── frontend/
    ├── src/
    │   ├── App.jsx     # React chat interface
    │   └── App.css     # Application styling
    ├── package.json
    └── vite.config.js  # Development server and API proxy
```

## Prerequisites

- Python 3.14 or newer
- Node.js 18 or newer
- npm
- A Groq API key
- A Tavily API key

## Environment Variables

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_api_key
TAVILY_API_KEY=your_tavily_api_key
```

> Keep API keys private and never commit the `.env` file.

## Installation

From the project root, install the Python dependencies with `uv`:

```bash
uv sync
```

Install the frontend dependencies:

```bash
cd frontend
npm install
```

## Running the Project

Start the FastAPI backend:

```bash
uv run uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

In a second terminal, start the React frontend:

```bash
cd frontend
npm run dev
```

Open:

- Frontend: http://localhost:5173
- API documentation: http://localhost:8000/docs

During development, Vite forwards `/api/*` requests to the backend running on
port `8000`.

## Using Deep Research

1. Enter a question or research topic.
2. For detailed topics, confirm **Deep Research** when prompted.
3. Watch each agent complete its assigned stage.
4. Open the report, critic review, raw search results, or scraped content.
5. Copy the finished report or review using the copy button.

You can also enable **Deep Research** in the composer to run the pipeline
without automatic topic detection.

## API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/chat` | Classifies the request and returns a chat or research prompt |
| `POST` | `/api/simple` | Returns a quick answer without the research pipeline |
| `POST` | `/api/research/stream` | Streams the complete research pipeline |
| `DELETE` | `/api/memory` | Clears ChromaDB memory for a chat session |
| `GET` | `/api/health` | Checks backend availability |

Example research request:

```json
{
  "topic": "The future of solid-state batteries",
  "session_id": "default"
}
```

## Standalone Pipeline

The research pipeline can also be run directly in the terminal:

```bash
uv run python pipline.py
```

Enter the topic when prompted.

## Frontend Commands

```bash
cd frontend
npm run dev
npm run build
npm run lint
npm run preview
```

## Memory and Chat History

- Browser chat history is stored in local storage under `mas_sessions`.
- Backend semantic conversation memory is persisted in `.chroma_db`.
- Clearing memory from the interface removes remembered turns for the active
  session.
- Clearing browser history removes conversations from the sidebar only.

## Troubleshooting

### Missing API token

Ensure `GROQ_API_KEY` and `TAVILY_API_KEY` exist in the root `.env` file, then
restart the backend.

### Backend returns a connection error

Confirm Uvicorn is running on `http://localhost:8000` and that port `8000`
allows local development connections.

### Frontend cannot reach the API

Run Vite from the `frontend` directory and confirm the backend proxy targets
`http://localhost:8000`.

### ChromaDB errors after a Python update

Stop the backend and remove the local `.chroma_db` directory, then restart the
application to create a fresh memory database.