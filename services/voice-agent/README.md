# myCashflo — Chotu AI Voice Agent

Autonomous voice collection agent that conducts empathetic, structured payment follow-ups over WebRTC/SIP using LiveKit or standalone local simulation.

## Overview

Chotu AI is designed for accounts receivable teams to automate repetitive collection outreach:
- Introduces itself politely in English / Hinglish
- Verifies identity of the accounts contact
- Communicates outstanding balance and overdue invoices
- Negotiates Promise to Pay (PTP) dates
- Logs outcomes, summaries, and transcripts into `CallSession` in myCashflo

## Quick Start

### 1. Interactive CLI Simulation (Zero Dependencies)

Run directly with standard Python 3.10+:

```powershell
python agent.py --simulate
```

You can pass custom test customers:
```powershell
python agent.py --simulate --customer "Mehta Traders Ltd" --amount "₹89,500"
```

### 2. LiveKit Cloud Mode (WebRTC Production)

1. Create a virtual environment and install dependencies:
```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

2. Copy `.env.example` to `.env` and fill in LiveKit + AI provider credentials:
```powershell
Copy-Item .env.example .env
```

3. Run the worker agent:
```powershell
python agent.py
```

### 3. Running Tests

```powershell
python -m unittest test_agent.py
```
