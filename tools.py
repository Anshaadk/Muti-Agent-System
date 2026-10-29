from langchain.tools import tool
import requests,os
from bs4 import BeautifulSoup
from tavily import TavilyClient
from dotenv import load_dotenv
load_dotenv()
from rich import print


tavily = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))


@tool
def web_search(query :str) -> str:
    """ Search the web for information on a topic return title,urls and snippets"""    
    response = tavily.search(query=query,max_results=5)
    results = []
    for result in response.get("results", []):
        results.append(
            f"Title: {result.get('title', 'No title')}\n"
            f"URL: {result.get('url', 'No URL')}\n"
            f"Content: {result.get('content', 'No content')[:300]}"
        )
    return "\n----\n".join(results)


@tool
def scrap_url(url: str) -> str:
    """Fetch a web page and return its clean text content using BeautifulSoup.

    Removes scripts, styles, and navigation noise. Returns the visible text
    (up to 5 000 characters) so an LLM can read it without processing raw HTML.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        )
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
    except requests.RequestException as e:
        return f"Error fetching URL: {e}"

    soup = BeautifulSoup(response.text, "lxml")

    # Drop tags that add no readable content
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "aside"]):
        tag.decompose()

    # Grab visible text, collapse whitespace
    text = soup.get_text(separator="\n")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    clean_text = "\n".join(lines)

    return clean_text[:3000]
