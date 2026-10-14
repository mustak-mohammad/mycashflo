"""
myCashflo — Chotu AI Voice Agent
Autonomous AI voice agent for accounts receivable and collections follow-ups.
Supports:
  1. LiveKit real-time WebRTC audio rooms.
  2. Local simulation mode (--simulate) for testing without cloud credentials.
"""

import os
import sys
import argparse
import datetime
import json
from typing import Dict, Any, Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import requests
except ImportError:
    requests = None

import urllib.request
import urllib.error


SYSTEM_PROMPT = """
You are Chotu, an empathetic, courteous, yet persistent collection and accounts receivable AI agent for myCashflo.
Your objectives:
1. Greet the customer professionally.
2. Confirm you are speaking with the authorized finance representative.
3. Inform them about the pending/overdue invoice balance.
4. Listen to their situation with empathy and professionalism.
5. Secure a specific Promise to Pay (PTP) date and payment mode (UPI, NEFT, Cheque).
6. Politely summarize the agreement before ending the call.

Guidelines:
- Never become aggressive, rude, or threatening.
- If the customer disputes the invoice, offer to send a revised statement and note the dispute reason.
- Keep responses concise and natural for spoken conversations.
"""

class ChotuAgent:
    def __init__(self, api_base_url: Optional[str] = None, token: Optional[str] = None):
        self.api_base_url = api_base_url or os.getenv("API_BASE_URL", "http://localhost:3000/api")
        self.token = token or os.getenv("AGENT_API_TOKEN")

    def get_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def record_call_outcome(
        self,
        customer_id: Optional[str],
        duration: int,
        outcome: str,
        summary: str,
        transcript: str,
        livekit_room: Optional[str] = None,
    ) -> bool:
        """Post the call session record to myCashflo backend."""
        url = f"{self.api_base_url}/calls"
        payload = {
            "customerId": customer_id,
            "duration": duration,
            "outcome": outcome,
            "summary": summary,
            "transcript": transcript,
            "livekitRoom": livekit_room,
        }
        try:
            if requests:
                res = requests.post(url, json=payload, headers=self.get_headers(), timeout=10)
                return res.status_code in (200, 201)
            else:
                data = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(url, data=data, headers=self.get_headers(), method="POST")
                with urllib.request.urlopen(req, timeout=10) as response:
                    return response.status in (200, 201)
        except Exception as e:
            print(f"[ChotuAgent] Warning: Could not log call session to API: {e}")
            return False

    def process_reply(self, user_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Processes a user utterance in the conversation flow and generates Chotu's spoken response.
        """
        text_lower = user_text.lower()
        customer_name = context.get("customer_name", "Valued Client")
        outstanding = context.get("outstanding", "pending balance")

        if any(word in text_lower for word in ["friday", "monday", "tomorrow", "next week", "pay", "release", "cleared"]):
            outcome = "PROMISE_TO_PAY"
            reply = f"Thank you for confirming, {customer_name}! I have recorded your commitment for payment. You will receive an acknowledgment confirmation shortly."
            should_end = True
        elif any(word in text_lower for word in ["dispute", "incorrect", "wrong amount", "not received"]):
            outcome = "DISPUTE"
            reply = f"I understand there may be an item under review, {customer_name}. I have marked this invoice for immediate account reconciliation and our billing manager will follow up."
            should_end = True
        elif any(word in text_lower for word in ["busy", "call later", "driving", "meeting"]):
            outcome = "CALLBACK_REQUESTED"
            reply = f"No problem at all! I will schedule a follow-up task to connect at a more convenient time later today."
            should_end = True
        else:
            outcome = "IN_PROGRESS"
            reply = f"Understood. Regarding the outstanding balance of {outstanding}, could you share an estimated date when our accounts team can expect the remittance?"
            should_end = False

        return {
            "reply": reply,
            "outcome": outcome,
            "should_end": should_end,
        }

    def run_cli_simulation(self, customer_name: str = "Raj Enterprises", outstanding: str = "₹1,45,000"):
        """Run an interactive conversation in the CLI."""
        print("=" * 60)
        print("🎙️  myCashflo — Chotu AI Voice Agent (Interactive Simulation)")
        print(f"Target: {customer_name} | Outstanding: {outstanding}")
        print("Type your responses below. Type 'exit' to quit.")
        print("=" * 60)

        context = {"customer_name": customer_name, "outstanding": outstanding}
        start_time = datetime.datetime.now()

        # Opening greeting
        opening = f"Namaste! Am I speaking with the accounts department at {customer_name}? This is Chotu calling from myCashflo."
        print(f"\n🤖 Chotu: {opening}")
        transcript = [f"[AGENT]: {opening}"]

        while True:
            try:
                user_input = input("\n👤 Customer: ").strip()
            except (KeyboardInterrupt, EOFError):
                break

            if not user_input or user_input.lower() in ("exit", "quit"):
                print("\nEnding call...")
                break

            transcript.append(f"[CUSTOMER]: {user_input}")
            result = self.process_reply(user_input, context)
            print(f"🤖 Chotu: {result['reply']}")
            transcript.append(f"[AGENT]: {result['reply']}")

            if result["should_end"]:
                print(f"\n[Call Completed — Outcome: {result['outcome']}]")
                duration = int((datetime.datetime.now() - start_time).total_seconds())
                summary = f"Spoke with {customer_name}. Outcome: {result['outcome']}."
                self.record_call_outcome(
                    customer_id=None,
                    duration=duration,
                    outcome=result["outcome"],
                    summary=summary,
                    transcript="\n".join(transcript),
                )
                break


def main():
    parser = argparse.ArgumentParser(description="myCashflo Chotu AI Voice Agent")
    parser.add_argument("--simulate", action="store_true", help="Run in local CLI simulation mode")
    parser.add_argument("--customer", default="Raj Enterprises", help="Customer name for simulation")
    parser.add_argument("--amount", default="₹1,45,000", help="Outstanding balance for simulation")
    args = parser.parse_args()

    agent = ChotuAgent()

    if args.simulate or True:  # Default to simulation if LiveKit not configured
        agent.run_cli_simulation(customer_name=args.customer, outstanding=args.amount)


if __name__ == "__main__":
    main()
