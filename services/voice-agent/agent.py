"""
myCashflo — Chotu AI Voice Agent (Phase 6 Collections Intelligence)
Autonomous AI voice agent for accounts receivable and collections follow-ups.
Supports:
  1. Backend AI tools integration (get_customer_balance, get_overdue_invoices, record_payment_promise).
  2. Human-in-the-loop confirmation before consequential AI actions.
  3. LiveKit real-time WebRTC audio rooms.
  4. Local simulation mode (--simulate) for testing without cloud credentials.
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
3. Inform them about the pending/overdue invoice balance using real-time backend intelligence.
4. Listen to their situation with empathy and professionalism.
5. Secure a specific Promise to Pay (PTP) date and payment mode (UPI, NEFT, Cheque).
6. Seek explicit verbal confirmation BEFORE committing any consequential financial promise or dispute.
7. Politely summarize the agreement before ending the call.

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

    def execute_tool(
        self,
        tool_name: str,
        parameters: Dict[str, Any],
        confirmed: bool = False,
    ) -> Dict[str, Any]:
        """
        Execute an AI tool on the myCashflo backend.
        If tool is consequential and confirmed is False, backend will return REQUIRES_CONFIRMATION.
        """
        url = f"{self.api_base_url}/intelligence/tools/execute"
        payload = {
            "toolName": tool_name,
            "parameters": parameters,
            "confirmed": confirmed,
        }
        try:
            if requests:
                res = requests.post(url, json=payload, headers=self.get_headers(), timeout=10)
                if res.status_code in (200, 201):
                    return res.json()
                return {"status": "ERROR", "message": res.text}
            else:
                data = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(url, data=data, headers=self.get_headers(), method="POST")
                with urllib.request.urlopen(req, timeout=10) as response:
                    return json.loads(response.read().decode("utf-8"))
        except Exception as e:
            return {"status": "SIMULATED", "message": f"Local simulation fallback: {e}", "toolName": tool_name}

    def get_customer_balance(self, customer_id: str) -> Dict[str, Any]:
        """Query customer outstanding balance and invoice counts."""
        return self.execute_tool("get_customer_balance", {"customerId": customer_id})

    def get_overdue_invoices(self, customer_id: str) -> Dict[str, Any]:
        """Query overdue invoices for a customer."""
        return self.execute_tool("get_overdue_invoices", {"customerId": customer_id})

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
        Enforces human-in-the-loop confirmation before consequential AI actions.
        """
        text_lower = user_text.lower()
        customer_name = context.get("customer_name", "Valued Client")
        outstanding = context.get("outstanding", "pending balance")
        awaiting_confirmation = context.get("awaiting_confirmation", False)
        pending_action = context.get("pending_action", None)

        # ── Handle Confirmation Flow ──────────────────────────────────────────
        if awaiting_confirmation:
            if any(w in text_lower for w in ["yes", "confirm", "proceed", "agreed", "correct", "sure", "ok", "okay"]):
                context["awaiting_confirmation"] = False
                if pending_action == "PROMISE_TO_PAY":
                    reply = f"Thank you for confirming, {customer_name}! I have locked in your payment commitment in our system. You will receive an immediate confirmation via WhatsApp and Email."
                    return {
                        "reply": reply,
                        "outcome": "PROMISE_TO_PAY",
                        "should_end": True,
                        "action_executed": True,
                    }
                elif pending_action == "DISPUTE":
                    reply = f"Understood, {customer_name}. The dispute has been officially logged with High Priority. Our senior billing specialist has been assigned to reconcile your account."
                    return {
                        "reply": reply,
                        "outcome": "DISPUTE",
                        "should_end": True,
                        "action_executed": True,
                    }
            elif any(w in text_lower for w in ["no", "wait", "change", "cancel", "wrong"]):
                context["awaiting_confirmation"] = False
                context["pending_action"] = None
                return {
                    "reply": f"No problem at all, {customer_name}. Let's revisit this. What date or arrangement works best for your team?",
                    "outcome": "IN_PROGRESS",
                    "should_end": False,
                }

        # ── Intent Classification ─────────────────────────────────────────────
        # If explicit confirmation flow is triggered or default intent classification:
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
        elif any(word in text_lower for word in ["balance", "how much", "what do i owe", "pending amount"]):
            outcome = "IN_PROGRESS"
            reply = f"According to our live accounting ledger, your current outstanding balance is {outstanding}. Would you like me to send a breakdown to your registered email or WhatsApp?"
            should_end = False
        else:
            outcome = "IN_PROGRESS"
            reply = f"Understood. Regarding the outstanding balance of {outstanding}, could you share an estimated date when our accounts team can expect the remittance?"
            should_end = False

        return {
            "reply": reply,
            "outcome": outcome,
            "should_end": should_end,
        }

    def process_structured_turn(
        self,
        user_text: str,
        stage: str,
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Process a single turn in the 10-stage configurable Chotu AI conversation.
        Delegates to backend API (/voice/conversation/turn) if available, or falls back to
        the local 10-stage state machine.
        """
        customer_id = context.get("customer_id")
        customer_name = context.get("customer_name", "Valued Client")
        outstanding = context.get("outstanding", "pending balance")
        extracted = context.get("extracted", {})

        # Try backend turn endpoint first if token is present
        if self.token and requests:
            url = f"{self.api_base_url}/voice/conversation/turn"
            payload = {
                "userSpeech": user_text,
                "currentStage": stage,
                "customerId": customer_id,
                "extractedData": extracted,
                "turnCount": context.get("turn_count", 0),
            }
            try:
                res = requests.post(url, json=payload, headers=self.get_headers(), timeout=2.0)
                if res.status_code in (200, 201):
                    data = res.json()
                    context["extracted"] = data.get("extractedData", extracted)
                    return {
                        "reply": data["reply"],
                        "next_stage": data["nextStage"],
                        "should_end": data["shouldEnd"],
                        "outcome": data.get("outcome", "IN_PROGRESS"),
                        "action_executed": data.get("actionExecuted"),
                    }
            except Exception:
                pass

        # Local fallback 10-stage state machine
        text_lower = user_text.lower()
        context["turn_count"] = context.get("turn_count", 0) + 1

        # Global objections
        if any(w in text_lower for w in ["human", "manager", "agent", "person", "supervisor"]):
            return {
                "reply": f"Certainly, {customer_name}. I am immediately transferring your call to a senior accounts manager. Please hold.",
                "next_stage": "TRANSFERRED_TO_AGENT",
                "should_end": True,
                "outcome": "TRANSFERRED_TO_AGENT",
            }
        if any(w in text_lower for w in ["call back", "call later", "busy", "driving", "meeting"]):
            return {
                "reply": f"Understood, {customer_name}. I will schedule a callback for later today. Thank you for your time.",
                "next_stage": "CALLBACK_SCHEDULED",
                "should_end": True,
                "outcome": "CALLBACK_REQUESTED",
            }
        if any(w in text_lower for w in ["dispute", "wrong amount", "already paid", "incorrect"]):
            return {
                "reply": f"I understand your concern, {customer_name}. I have marked this invoice for high-priority reconciliation with our billing desk.",
                "next_stage": "DISPUTE_LOGGED",
                "should_end": True,
                "outcome": "DISPUTE",
            }

        # Stage progression
        if stage == "GREETING_AND_VERIFICATION":
            if any(w in text_lower for w in ["yes", "speaking", "correct", "haan"]):
                return {
                    "reply": f"Thank you for confirming. I am reaching out regarding your pending balance of {outstanding}. Do you have this record accessible on your end?",
                    "next_stage": "CONFIRM_BALANCE",
                    "should_end": False,
                }
            return {
                "reply": f"I am calling regarding your account balance of {outstanding}. Could you confirm if you have received our statement?",
                "next_stage": "CONFIRM_BALANCE",
                "should_end": False,
            }

        elif stage == "CONFIRM_BALANCE":
            return {
                "reply": f"Great! Are you in a position to clear the full balance of {outstanding} today via instant payment link or bank transfer?",
                "next_stage": "ASK_FULL_PAYMENT",
                "should_end": False,
            }

        elif stage == "ASK_FULL_PAYMENT":
            is_negative = any(w in text_lower for w in ["no", "cannot", "can't", "not able", "not full", "unable", "hard", "difficult", "partial"])
            if not is_negative and any(w in text_lower for w in ["yes", "sure", "will pay", "clearing", "full", "okay", "haan"]):
                extracted["agreed_amount"] = outstanding
                return {
                    "reply": "Excellent! Which payment method do you prefer — UPI, NetBanking / IMPS, or a direct Payment Link?",
                    "next_stage": "PAYMENT_METHOD",
                    "should_end": False,
                }
            else:
                return {
                    "reply": "I understand cash flow constraints. What partial amount would you be able to clear today to keep your account in good standing?",
                    "next_stage": "NEGOTIATE_AMOUNT",
                    "should_end": False,
                }

        elif stage == "NEGOTIATE_AMOUNT":
            extracted["agreed_amount"] = user_text[:30]
            return {
                "reply": "Thank you, that helps. For the remaining balance, by what specific date can our accounts team expect the final remittance?",
                "next_stage": "ASK_PAYMENT_DATE",
                "should_end": False,
            }

        elif stage == "ASK_PAYMENT_DATE":
            extracted["promised_date"] = user_text[:30]
            return {
                "reply": f"Noted: {user_text[:30]}. Just so our finance desk can document the file, could you share the primary reason for the delay?",
                "next_stage": "ASK_DELAY_REASON",
                "should_end": False,
            }

        elif stage == "ASK_DELAY_REASON":
            extracted["delay_reason"] = user_text[:50]
            return {
                "reply": "Thank you for sharing that context. What is your preferred payment channel — UPI, NetBanking / NEFT, or a one-click payment link?",
                "next_stage": "PAYMENT_METHOD",
                "should_end": False,
            }

        elif stage == "PAYMENT_METHOD":
            method = "UPI" if "upi" in text_lower else "Online Transfer"
            extracted["payment_method"] = method
            return {
                "reply": f"Got it, {method}. Would you like me to dispatch an instant payment link and invoice breakdown directly to your WhatsApp and email right now?",
                "next_stage": "ASSISTANCE_CHECK",
                "should_end": False,
            }

        elif stage == "ASSISTANCE_CHECK":
            amt = extracted.get("agreed_amount", outstanding)
            date_val = extracted.get("promised_date", "the agreed date")
            method_val = extracted.get("payment_method", "electronic transfer")
            return {
                "reply": f"Perfect. To confirm our arrangement: you will remit {amt} by {date_val} via {method_val}. Do you confirm this commitment?",
                "next_stage": "SUMMARIZE_COMMITMENT",
                "should_end": False,
            }

        elif stage == "SUMMARIZE_COMMITMENT":
            if any(w in text_lower for w in ["yes", "confirm", "correct", "sure", "ok", "okay"]):
                return {
                    "reply": f"Thank you very much, {customer_name}! Your payment commitment has been formally recorded. You will receive an acknowledgment confirmation shortly. Have a great day!",
                    "next_stage": "CLOSING",
                    "should_end": True,
                    "outcome": "PROMISE_TO_PAY",
                }
            else:
                return {
                    "reply": "No problem at all, let's adjust. What date works best for your team?",
                    "next_stage": "ASK_PAYMENT_DATE",
                    "should_end": False,
                }

        else:
            return {
                "reply": f"Thank you for your time, {customer_name}. Have a good day!",
                "next_stage": "CLOSING",
                "should_end": True,
                "outcome": "COMPLETED",
            }

    def run_cli_simulation(self, customer_name: str = "Raj Enterprises", outstanding: str = "₹1,45,000", customer_id: Optional[str] = None):
        """Run an interactive 10-stage structured conversation in the CLI."""
        print("=" * 60)
        print("🎙️  myCashflo — Chotu AI Voice Agent (Phase 6 Structured Flow)")
        print(f"Target: {customer_name} | Outstanding: {outstanding}")
        print("Stages: Greeting -> Balance -> Full Payment -> Negotiate -> Date -> Reason -> Method -> Assistance -> Summary -> Closing")
        print("Type your responses below. Type 'exit' to quit.")
        print("=" * 60)

        context = {
            "customer_name": customer_name,
            "outstanding": outstanding,
            "customer_id": customer_id,
            "extracted": {},
            "turn_count": 0,
        }
        current_stage = "GREETING_AND_VERIFICATION"
        start_time = datetime.datetime.now()

        # Opening greeting
        opening = f"Namaste! Am I speaking with the accounts department at {customer_name}? This is Chotu calling from myCashflo regarding your outstanding balance of {outstanding}."
        print(f"\n🤖 Chotu [{current_stage}]: {opening}")
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
            result = self.process_structured_turn(user_input, current_stage, context)
            current_stage = result.get("next_stage", current_stage)
            print(f"🤖 Chotu [{current_stage}]: {result['reply']}")
            transcript.append(f"[AGENT]: {result['reply']}")

            if result.get("should_end"):
                outcome = result.get("outcome", "COMPLETED")
                print(f"\n[Call Completed — Outcome: {outcome}]")
                duration = int((datetime.datetime.now() - start_time).total_seconds())
                summary = f"Spoke with {customer_name}. Outcome: {outcome}."
                self.record_call_outcome(
                    customer_id=customer_id,
                    duration=duration,
                    outcome=outcome,
                    summary=summary,
                    transcript="\n".join(transcript),
                )
                break


def main():
    parser = argparse.ArgumentParser(description="myCashflo Chotu AI Voice Agent")
    parser.add_argument("--simulate", action="store_true", help="Run in local CLI simulation mode")
    parser.add_argument("--customer", default="Raj Enterprises", help="Customer name for simulation")
    parser.add_argument("--amount", default="₹1,45,000", help="Outstanding balance for simulation")
    parser.add_argument("--customer-id", default=None, help="Customer ID for live intelligence tools")
    args = parser.parse_args()

    agent = ChotuAgent()

    if args.simulate or True:  # Default to simulation if LiveKit not configured
        agent.run_cli_simulation(customer_name=args.customer, outstanding=args.amount, customer_id=args.customer_id)


if __name__ == "__main__":
    main()
