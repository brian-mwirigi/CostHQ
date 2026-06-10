# Quickstart: Python (FastAPI / LangChain)

CostHQ is primarily a local daemon. You can easily integrate it into any Python application (like FastAPI or LangChain) by making simple HTTP requests to the local CostHQ REST API.

## 1. Start the CostHQ Daemon

Ensure the CostHQ dashboard/API is running in the background:

```bash
cs dashboard &
```

## 2. Create a Helper Function

Drop this lightweight snippet into your Python project to push API usage and costs directly to the CostHQ platform.

```python
import requests
from datetime import datetime

COSTHQ_API = "http://127.0.0.1:3737/api/v1"

def track_ai_cost(session_name: str, provider: str, model: str, prompt_tokens: int, completion_tokens: int):
    """
    Sends AI usage to the local CostHQ daemon.
    """
    try:
        # CostHQ automatically calculates the dollar cost based on its internal pricing engine
        payload = {
            "sessionName": session_name,
            "provider": provider,
            "model": model,
            "promptTokens": prompt_tokens,
            "completionTokens": completion_tokens,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        requests.post(f"{COSTHQ_API}/sessions/active/ai", json=payload)
    except Exception as e:
        print(f"CostHQ tracking failed: {e}")

# Example Usage
track_ai_cost(
    session_name="FastAPI /generate Route",
    provider="openai",
    model="gpt-4o",
    prompt_tokens=150,
    completionTokens=50
)
```

## 3. Integrating with LangChain

If you are using LangChain, you can wrap the `track_ai_cost` function inside a custom `BaseCallbackHandler` to automatically intercept and track LLM usage across your entire chain!

```python
from langchain.callbacks.base import BaseCallbackHandler

class CostHQCallbackHandler(BaseCallbackHandler):
    def on_llm_end(self, response, **kwargs):
        if response.llm_output and "token_usage" in response.llm_output:
            usage = response.llm_output["token_usage"]
            model_name = response.llm_output.get("model_name", "unknown")
            
            track_ai_cost(
                session_name="LangChain Agent",
                provider="openai",
                model=model_name,
                prompt_tokens=usage.get("prompt_tokens", 0),
                completion_tokens=usage.get("completion_tokens", 0)
            )
```

You get full session summaries and platform analytics without leaving your Python ecosystem!
