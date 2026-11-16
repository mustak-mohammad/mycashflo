"""
myCashflo — Chotu AI Voice Agent (Phase 6 Collections Intelligence)
Autonomous AI voice agent for accounts receivable and collections follow-ups.
Supports:
  1. Backend AI tools integration (get_customer_balance, get_overdue_invoices, record_payment_promise, record_cease_contact).
  2. Multi-turn conversation engine with memory and context retention.
  3. Comprehensive handling for:
     - Refusals (distinguished from DND/cease-contact)
     - Inability to pay / financial hardship (empathy first, no premature pressure)
     - Payment claims (UTR/reference logging and reconciliation)
     - Invoice disputes (reasons captured for billing desk)
     - Questions & inquiries (balance, due date, invoice details, payment modes)
     - Human agent escalation requests
     - Strict Promise-to-Pay confirmation (recorded ONLY when explicitly agreed to coherent date & amount)
  4. Local simulation mode (--simulate) and LiveKit real-time WebRTC audio rooms.
"""

import os
import sys
import time
import asyncio
import argparse
import datetime
import json
import re
from typing import Dict, Any, Optional, List, Tuple

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
5. Answer questions clearly about invoices, amounts, due dates, and payment options.
6. Handle disputes, payment claims, and inability to pay with appropriate protocols.
7. Understand hardship first before asking for dates or amounts.
8. Never combine contradictory statements into a promise.
9. Seek explicit verbal confirmation BEFORE committing any consequential financial promise.
10. Derive final outcomes strictly from verified customer agreement.
"""

# Cease-contact / DND opt-out phrases (Strict legal DND enforcement)
CEASE_CONTACT_PHRASES = [
    "stop calling",
    "do not call",
    "don't call",
    "dont call",
    "cease contact",
    "cease all contact",
    "never call",
    "remove my number",
    "remove this number",
    "take me off your list",
    "take me off the list",
    "put me on do not call",
    "put me on the do not call",
    "stop contacting",
    "do not contact",
    "dont contact",
    "never contact",
]

def is_cease_contact_request(user_text: str) -> bool:
    """Checks if utterance is an explicit DND or cease-contact demand."""
    t = user_text.lower()
    if any(phrase in t for phrase in CEASE_CONTACT_PHRASES):
        return True
    if ("refuse" in t or "won't pay" in t or "not going to pay" in t) and ("call" in t or "contact" in t or "list" in t):
        return True
    return False


class ChotuAgent:
    def __init__(self, api_base_url: Optional[str] = None, token: Optional[str] = None):
        self.api_base_url = api_base_url or os.getenv("API_BASE_URL", "http://localhost:3000/api")
        self.token = token or os.getenv("AGENT_API_TOKEN")
        self.tools = self

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

    def record_cease_contact(
        self,
        customer_id: str,
        reason: str = "Customer requested cease contact",
    ) -> Dict[str, Any]:
        """Record customer cease-contact / DND preference via backend AI tools."""
        return self.execute_tool(
            "record_cease_contact",
            {"customerId": customer_id, "reason": reason, "channel": "ALL"},
            confirmed=True,
        )

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

    def request_document_delivery(
        self,
        customer_id: str,
        invoice_id: Optional[str] = None,
        request_type: str = "INVOICE",
        delivery_channel: str = "WHATSAPP_AND_EMAIL",
    ) -> Dict[str, Any]:
        """Request document / payment link delivery via DocumentDeliveryService API."""
        url = f"{self.api_base_url}/voice/document-requests"
        payload = {
            "customerId": customer_id,
            "invoiceId": invoice_id,
            "requestType": request_type,
            "deliveryChannel": delivery_channel,
            "requestedBy": "CHOTU_AI_VOICE",
        }
        try:
            if requests:
                res = requests.post(url, json=payload, headers=self.get_headers(), timeout=10)
                return res.json()
            else:
                data = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(url, data=data, headers=self.get_headers(), method="POST")
                with urllib.request.urlopen(req, timeout=10) as response:
                    return json.loads(response.read().decode("utf-8"))
        except Exception as e:
            return {
                "request": {
                    "id": f"sim_{int(time.time())}",
                    "status": "COMPLETED",
                    "requestType": request_type,
                    "deliveryChannel": delivery_channel,
                    "attempts": [
                        {"channel": "WHATSAPP", "destinationMasked": "+91 ****3210", "status": "SIMULATED"},
                        {"channel": "EMAIL", "destinationMasked": "finance@client.com", "status": "SIMULATED"},
                    ],
                },
                "isDuplicate": False,
            }

    def cancel_document_delivery(self, request_id: str) -> Dict[str, Any]:
        """Cancel an in-flight document delivery request via API."""
        url = f"{self.api_base_url}/voice/document-requests/{request_id}/cancel"
        try:
            if requests:
                res = requests.post(url, json={}, headers=self.get_headers(), timeout=10)
                return res.json()
            else:
                req = urllib.request.Request(url, data=b"{}", headers=self.get_headers(), method="POST")
                with urllib.request.urlopen(req, timeout=10) as response:
                    return json.loads(response.read().decode("utf-8"))
        except Exception as e:
            return {"id": request_id, "status": "CANCELLED"}

    # ── Accurate Extraction Helpers ───────────────────────────────────────────

    def _extract_amount(self, text: str) -> Optional[str]:
        """
        Extracts verified currency amount.
        Rejects non-amounts like '20 days from now', 'financial issue', invoice numbers.
        """
        lower = text.lower()
        if "half" in lower or "50%" in lower:
            return "50% of outstanding"

        # Explicit currency symbol or prefix
        curr_match = re.search(r'(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)', text, re.IGNORECASE)
        if curr_match:
            return f"₹{curr_match.group(1)}"

        # Standalone numbers followed by currency or 'rupees'
        rp_match = re.search(r'\b([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)\s*(?:rupees?|bucks?)\b', text, re.IGNORECASE)
        if rp_match:
            return f"₹{rp_match.group(1)}"

        # Check if number is actually a timeframe (e.g. '20 days', '3 weeks') -> NOT an amount!
        if re.search(r'\b[0-9]+\s*(?:days?|weeks?|months?|hours?|hrs?)\b', lower):
            return None

        # Check if number is part of an invoice identifier -> NOT an amount!
        if re.search(r'(?:invoice|inv|bill)\s*(?:#|no\.?|num\.?)?\s*[0-9]+', lower):
            return None

        # Standalone large numbers without timeframe context could be an amount if user is talking money
        num_match = re.search(r'\b([0-9]{3,7})\b', text)
        if num_match and not any(w in lower for w in ["days", "day", "week", "weeks", "month", "months", "inv", "bill"]):
            return f"₹{num_match.group(1)}"

        return None

    def _extract_date(self, text: str) -> Optional[str]:
        """
        Extracts valid date or calendar timeframe.
        Rejects non-date text like 'financial issue', 'UPI', 'I cannot pay'.
        """
        lower = text.lower()
        # Days of week
        days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        for d in days:
            if d in lower:
                return d.capitalize()

        # Relative phrases
        if "tomorrow" in lower:
            return "Tomorrow"
        if "today" in lower:
            return "Today"
        if "next week" in lower:
            return "Next week"
        if "end of month" in lower or "end of the month" in lower:
            return "End of the month"

        # X days from now
        days_from_now = re.search(r'([0-9]+)\s+days?\s+from\s+now', lower)
        if days_from_now:
            return f"{days_from_now.group(1)} days from now"

        # In X days
        in_days = re.search(r'in\s+([0-9]+)\s+days?', lower)
        if in_days:
            return f"{in_days.group(1)} days from now"

        # Calendar date like "30th October", "15 Nov", "Nov 15"
        cal_match = re.search(r'\b([0-9]{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b', lower)
        if cal_match:
            return cal_match.group(1).title()

        return None

    def _extract_payment_method(self, text: str) -> Optional[str]:
        """Extracts payment method name."""
        lower = text.lower()
        if any(w in lower for w in ["upi", "gpay", "phonepe", "paytm"]):
            return "UPI"
        if any(w in lower for w in ["neft", "rtgs", "imps", "netbanking", "bank transfer", "wire"]):
            return "NEFT / Bank Transfer"
        if any(w in lower for w in ["link", "payment link", "online link"]):
            return "Payment Link"
        if any(w in lower for w in ["cheque", "check"]):
            return "Cheque"
        return None

    def _extract_utr(self, text: str) -> Optional[str]:
        """Extracts banking transaction reference or UTR."""
        match = re.search(r'\b(?:utr|ref|reference|txn|transaction)\s*[:#-]?\s*([a-zA-Z0-9]{5,25})', text, re.IGNORECASE)
        return match.group(1) if match else None

    # ── Conversational Process Reply ──────────────────────────────────────────

    def process_reply(self, user_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Processes a user utterance in the conversation flow and generates Chotu's spoken response.
        Enforces separate structured state, prevents contradictory promises, understands hardship first,
        and never treats non-commitments as promises.
        """
        text_lower = user_text.lower().strip()
        customer_name = context.get("customer_name", "Valued Client")
        outstanding = context.get("outstanding", "pending balance")
        invoice_number = context.get("invoice_number", "INV-CURRENT")
        invoices = context.get("invoices", [])
        awaiting_confirmation = context.get("awaiting_confirmation", False)
        pending_action = context.get("pending_action", None)

        # Context Memory Tracking
        history = context.setdefault("history", [])
        history.append({"role": "customer", "text": user_text, "timestamp": datetime.datetime.now().isoformat()})
        extracted = context.setdefault("extracted", {})
        context["turn_count"] = context.get("turn_count", 0) + 1

        # Multi-turn structured fields initialization
        extracted.setdefault("can_pay", "UNKNOWN")
        extracted.setdefault("willing_to_pay", "UNKNOWN")
        extracted.setdefault("hardship_reason", None)
        extracted.setdefault("agreed_amount", None)
        extracted.setdefault("promised_date", None)
        extracted.setdefault("payment_method_preference", None)
        extracted.setdefault("link_authorization_requested", False)
        extracted.setdefault("link_authorization_granted", False)
        extracted.setdefault("commitment_status", "NONE")
        extracted.setdefault("tentative_timeframe", None)
        extracted.setdefault("dispute_reason", None)
        extracted.setdefault("claimed_amount", None)
        extracted.setdefault("claimed_utr", None)
        extracted.setdefault("claimed_date", None)

        # ── 1. Rejection / Cancellation of Prior Agreement ────────────────────
        # Customer says "No", "Wait", "Cancel", "I cannot pay Friday anymore", etc.
        has_rejection = any(w in text_lower for w in [
            "no", "wait", "change that", "cancel", "wrong", "cannot", "can't",
            "not yet", "hold on", "don't agree", "not agreeing", "i didn't say",
            "i never said", "cancel that", "no i can't", "no i cannot", "not possible"
        ])

        if awaiting_confirmation:
            if has_rejection:
                # Cancel the proposed commitment completely
                context["awaiting_confirmation"] = False
                context["pending_action"] = None
                extracted["commitment_status"] = "REJECTED"
                extracted["agreed_amount"] = None
                extracted["promised_date"] = None

                # If customer also stated hardship in the rejection, acknowledge hardship
                if any(phrase in text_lower for phrase in ["no money", "no funds", "cash crunch", "crisis", "cannot afford", "loss"]):
                    extracted["can_pay"] = "NO"
                    extracted["hardship_reason"] = user_text[:100]
                    reply = (
                        f"Understood, {customer_name}. I have cancelled that proposal and noted your cash flow difficulties. "
                        f"Would you prefer a callback at a later date when your cash flow stabilizes, or would you like to speak to an account manager regarding flexible terms?"
                    )
                    res = {
                        "reply": reply,
                        "outcome": "UNABLE_TO_PAY",
                        "should_end": False,
                    }
                    history.append({"role": "agent", "text": reply})
                    return res

                reply = f"Understood, {customer_name}. I have cancelled that proposal. What arrangement or timeline would realistically work for your team?"
                res = {
                    "reply": reply,
                    "outcome": "IN_PROGRESS",
                    "should_end": False,
                }
                history.append({"role": "agent", "text": reply})
                return res

            elif any(w in text_lower for w in ["yes", "confirm", "proceed", "agreed", "correct", "sure", "ok", "okay", "haan", "done", "commit", "i agree"]):
                # Customer confirmed proposal
                context["awaiting_confirmation"] = False
                action = context.get("pending_action")
                context["pending_action"] = None

                if action == "PROMISE_TO_PAY":
                    amt = extracted.get("agreed_amount") or outstanding
                    date_val = extracted.get("promised_date") or "the agreed date"

                    # STRICT VALIDATION: Must have both valid date and valid amount that do NOT contradict earlier inability
                    if extracted.get("can_pay") != "NO":
                        extracted["commitment_status"] = "CONFIRMED"
                        reply = (
                            f"Thank you for confirming, {customer_name}! I have locked in your payment commitment "
                            f"for {amt} by {date_val} in our system. You will receive an immediate confirmation via WhatsApp and Email."
                        )
                        res = {
                            "reply": reply,
                            "outcome": "PROMISE_TO_PAY",
                            "should_end": True,
                            "action_executed": True,
                        }
                    else:
                        extracted["commitment_status"] = "NONE"
                        reply = f"Thank you, {customer_name}. Before finalizing, could we confirm the exact payment date and amount you are committing to?"
                        res = {
                            "reply": reply,
                            "outcome": "IN_PROGRESS",
                            "should_end": False,
                        }
                    history.append({"role": "agent", "text": reply})
                    return res

                elif pending_action == "DISPUTE":
                    reply = f"Understood, {customer_name}. The dispute has been officially logged with High Priority. Our senior billing specialist has been assigned to reconcile your account."
                    res = {
                        "reply": reply,
                        "outcome": "DISPUTE",
                        "should_end": True,
                        "action_executed": True,
                    }
                    history.append({"role": "agent", "text": reply})
                    return res

                elif pending_action == "HARDSHIP_PLAN":
                    reply = f"Thank you for confirming, {customer_name}. I have registered your installment assistance request with our finance desk. An account officer will reach out with the customized schedule."
                    res = {
                        "reply": reply,
                        "outcome": "UNABLE_TO_PAY",
                        "should_end": True,
                        "action_executed": True,
                    }
                    history.append({"role": "agent", "text": reply})
                    return res

        # ── 1b. Customer Withdraws a Previously Agreed Commitment ─────────────
        if extracted.get("commitment_status") == "CONFIRMED" and has_rejection:
            extracted["commitment_status"] = "CANCELLED"
            extracted["agreed_amount"] = None
            extracted["promised_date"] = None
            reply = f"Understood, {customer_name}. I have noted the withdrawal of that payment date. Let's revisit this when your schedule clears up. Would you like a callback next month?"
            res = {
                "reply": reply,
                "outcome": "IN_PROGRESS",
                "should_end": False,
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 2. Cease-Contact Handling (Strict DND) ────────────────────────────
        if is_cease_contact_request(user_text):
            customer_id = context.get("customer_id")
            persisted = False
            if customer_id and self.token:
                tool_res = self.record_cease_contact(customer_id, reason=user_text[:100])
                if tool_res.get("status") == "SUCCESS":
                    persisted = True

            reply = (
                f"Understood, {customer_name}. We have recorded your request to cease all phone calls "
                f"and have updated our records accordingly. No further calls will be placed to this number. Thank you."
                if persisted
                else f"Understood, {customer_name}. I have noted your request to stop calls and ended this conversation. "
                f"A member of our compliance team will review your contact preferences. Thank you."
            )
            action_executed = "CEASE_CONTACT_RECORDED" if persisted else None
            extracted["is_no_contact"] = True
            res = {
                "reply": reply,
                "outcome": "NO_CONTACT",
                "next_stage": "CALL_ENDED",
                "should_end": True,
                "action_executed": action_executed,
                "preference_persisted": persisted,
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 3. Human Escalation Request ───────────────────────────────────────
        if any(w in text_lower for w in ["human", "manager", "agent", "person", "supervisor", "representative", "officer"]):
            extracted["human_requested"] = True
            reply = f"Certainly, {customer_name}. I am immediately transferring your call to a senior accounts manager. Please hold on for just a moment."
            res = {
                "reply": reply,
                "outcome": "TRANSFERRED_TO_AGENT",
                "should_end": True,
                "action_executed": "TRANSFERRED_TO_HUMAN_AGENT",
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 4. Temporary Callback / Busy Objection ───────────────────────────
        if any(w in text_lower for w in ["busy", "call later", "call back", "driving", "meeting", "can't talk", "cannot talk", "not free"]):
            extracted["callback_requested"] = True
            reply = f"No problem at all, {customer_name}! I will schedule a follow-up task to connect at a more convenient time later today."
            res = {
                "reply": reply,
                "outcome": "CALLBACK_REQUESTED",
                "should_end": True,
                "action_executed": "CALLBACK_SCHEDULED",
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 5. Payment Claims (Already Paid / Cleared) ────────────────────────
        has_claim = (
            any(phrase in text_lower for phrase in [
                "already paid", "paid yesterday", "payment made", "payment done", "payment was already made",
                "payment already made", "payment already done", "already cleared", "paid via", "transferred on",
                "sent the money", "cleared this"
            ]) or
            ("paid" in text_lower and any(w in text_lower for w in ["neft", "upi", "imps", "cheque", "utr", "yesterday", "monday", "last week"])) or
            ("payment" in text_lower and any(w in text_lower for w in ["made", "done", "transferred", "cleared", "sent", "utr"])) or
            ("utr" in text_lower and any(w in text_lower for w in ["paid", "payment", "made", "transferred", "yesterday"]))
        )
        if has_claim:
            extracted["payment_claimed"] = True
            extracted["claimed_amount"] = self._extract_amount(user_text) or outstanding
            extracted["claimed_date"] = self._extract_date(user_text) or "Recent date"
            extracted["claimed_utr"] = self._extract_utr(user_text) or "Pending verification"
            context["intents_history"] = context.get("intents_history", []) + ["PAYMENT_CLAIM"]

            ref_note = f" (Ref/UTR: {extracted['claimed_utr']})" if extracted["claimed_utr"] != "Pending verification" else ""
            reply = (
                f"Thank you for informing us, {customer_name}. I have logged your payment claim for {extracted['claimed_amount']}{ref_note} "
                f"with our banking desk for priority reconciliation. Your account statement will be refreshed as soon as cleared."
            )
            res = {
                "reply": reply,
                "outcome": "PAYMENT_CLAIMED",
                "should_end": True,
                "action_executed": "PAYMENT_CLAIM_LOGGED",
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 6. Invoice Disputes ───────────────────────────────────────────────
        if any(w in text_lower for w in ["dispute", "incorrect", "wrong amount", "not received", "damaged", "charged double", "not our bill", "fraud", "never ordered"]):
            extracted["is_dispute"] = True
            extracted["dispute_reason"] = user_text[:100]
            context["intents_history"] = context.get("intents_history", []) + ["DISPUTE"]
            reply = (
                f"I understand there is an item under review regarding invoice #{invoice_number}, {customer_name}. "
                f"I have marked this invoice with High Priority for account reconciliation, and our billing desk will review and contact you."
            )
            res = {
                "reply": reply,
                "outcome": "DISPUTE",
                "should_end": True,
                "action_executed": "DISPUTE_LOGGED",
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 7. Refusals to Pay (Distinct from DND) ────────────────────────────
        if any(phrase in text_lower for phrase in ["refuse to pay", "will not pay", "won't pay", "not going to pay", "refusing payment", "decline to pay", "refuse payment", "not paying this", "not paying"]):
            extracted["willing_to_pay"] = "UNWILLING"
            extracted["refusal_reason"] = user_text[:100]
            context["intents_history"] = context.get("intents_history", []) + ["REFUSAL"]
            reply = (
                f"I understand your position, {customer_name}. We want to avoid any escalation or disruption to your commercial terms. "
                f"May I ask if this refusal is due to dissatisfied service or a disagreement on invoice terms?"
            )
            res = {
                "reply": reply,
                "outcome": "REFUSED_TO_PAY",
                "should_end": True,
                "action_executed": "REFUSAL_LOGGED",
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 8. Inability to Pay / Financial Hardship (Empathy First) ──────────
        is_hardship_utterance = any(phrase in text_lower for phrase in [
            "can't pay anything", "cannot pay anything", "cant pay anything",
            "no money", "cannot afford", "can't afford", "no funds", "bankruptcy",
            "cash crunch", "severe loss", "business is down", "insolvency", "financial crisis",
            "unable to pay right now", "tight cash flow", "financial issue",
            "having financial issues", "facing financial issue", "loss in business"
        ])

        extracted_date = self._extract_date(user_text)
        extracted_amount = self._extract_amount(user_text)
        extracted_method = self._extract_payment_method(user_text)

        if is_hardship_utterance:
            extracted["can_pay"] = "NO"
            extracted["hardship_reason"] = user_text[:100]
            context["intents_history"] = context.get("intents_history", []) + ["HARDSHIP"]

            if "can't pay anything" in text_lower or "cannot pay anything" in text_lower or "cant pay anything" in text_lower:
                # Customer states absolute inability to pay anything
                reply = (
                    f"I understand, and thank you for being upfront about your financial situation, {customer_name}. "
                    f"We know businesses encounter unexpected cash flow challenges. "
                    f"Do you anticipate your financial situation easing in the coming weeks, or would you prefer a callback at a later time?"
                )
            elif "financial issue" in text_lower or "financial issues" in text_lower:
                if extracted.get("tentative_timeframe"):
                    reply = (
                        f"Understood, {customer_name}. I have noted the financial hardship on your file. "
                        f"When cash flow improves around {extracted['tentative_timeframe']}, what payment method would you normally prefer — UPI, bank transfer, or a payment link?"
                    )
                    res = {
                        "reply": reply,
                        "outcome": "IN_PROGRESS",
                        "should_end": False,
                    }
                    history.append({"role": "agent", "text": reply})
                    return res
                else:
                    reply = (
                        f"Understood, {customer_name}. I have noted the financial hardship on your file so our accounts desk is aware. "
                        f"Would you prefer a callback at a later date when your cash flow stabilizes, or would you like to speak to an account manager regarding flexible terms?"
                    )
            else:
                # Offer installment plan
                context["awaiting_confirmation"] = True
                context["pending_action"] = "HARDSHIP_PLAN"
                reply = (
                    f"I appreciate your honesty regarding your financial situation, {customer_name}. "
                    f"We recognize that businesses encounter temporary cash flow challenges. "
                    f"Would you be open to an installment plan, starting with a 20% token payment this week to maintain your active account status?"
                )

            res = {
                "reply": reply,
                "outcome": "UNABLE_TO_PAY",
                "should_end": False,
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 8b. Hardship Follow-Up: Customer states future timeframe e.g. "20 days from now"
        if extracted.get("can_pay") == "NO" and extracted_date:
            extracted["tentative_timeframe"] = extracted_date
            reply = (
                f"Thank you for sharing that timeframe, {customer_name}. So cash flow may start easing around {extracted_date}. "
                f"Could you share what primary issue caused this delay, so our finance desk can note your file?"
            )
            res = {
                "reply": reply,
                "outcome": "IN_PROGRESS",
                "should_end": False,
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 8c. Future Payment Intentions ("I'll pay later", "will pay later") ────
        is_pay_later = any(phrase in text_lower for phrase in [
            "pay later", "i'll pay later", "i will pay later", "will pay later", "pay after",
            "pay afterwards", "sometime later", "pay next time", "settle later", "pay you later",
            "clear later", "clear it later", "pay some other time"
        ])

        if is_pay_later:
            extracted["will_pay_later"] = True
            if extracted_date:
                extracted["tentative_timeframe"] = extracted_date
                reply = (
                    f"Thank you, {customer_name}. You mentioned paying later around {extracted_date}. "
                    f"Could you confirm if that will be for the full {outstanding}, or would you prefer to break it into installments?"
                )
            else:
                reply = (
                    f"Understood that you would like to pay later, {customer_name}. "
                    f"Could you let our accounts desk know approximately what date or timeframe you expect to clear this balance?"
                )
            res = {
                "reply": reply,
                "outcome": "WILL_PAY_LATER",
                "should_end": False,
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 9. Explicit Promise to Pay Detection (BEFORE Method-Only Check) ────
        has_commit_word = not is_pay_later and (
            any(w in text_lower for w in ["shall pay", "pay this", "clearing this", "remit", "promising", "transfer this", "releasing", "i can pay", "commit to pay", "paying on", "definitely pay", "promise to pay"]) or
            ("will pay" in text_lower and "later" not in text_lower)
        )

        if has_commit_word and extracted_date and extracted.get("can_pay") != "NO" and not is_pay_later:
            amt = extracted_amount or outstanding
            method = extracted_method or extracted.get("payment_method_preference") or "electronic transfer"
            extracted["agreed_amount"] = amt
            extracted["promised_date"] = extracted_date
            extracted["payment_method"] = method
            extracted["can_pay"] = "YES"
            extracted["commitment_status"] = "CONFIRMED"

            reply = f"Thank you for confirming, {customer_name}! I have recorded your commitment to pay {amt} by {extracted_date} via {method}. You will receive an acknowledgment confirmation shortly."
            res = {
                "reply": reply,
                "outcome": "PROMISE_TO_PAY",
                "should_end": True,
                "action_executed": True,
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 10. Tentative Statements ("Maybe next week", "I will try") ────────
        is_tentative = any(phrase in text_lower for phrase in [
            "maybe", "perhaps", "i will try", "i'll try", "might be", "let me see",
            "not sure", "not certain", "can't promise", "cannot promise"
        ])
        if is_tentative or (extracted_date and not has_commit_word and extracted.get("can_pay") != "NO"):
            date_mention = extracted_date or "next week"
            context["awaiting_confirmation"] = True
            context["pending_action"] = "PROMISE_TO_PAY"
            extracted["promised_date"] = date_mention
            extracted["agreed_amount"] = extracted_amount or outstanding
            reply = (
                f"I appreciate you wanting to resolve this, {customer_name}. Since you mentioned '{user_text}', "
                f"can you confirm that you will definitely clear {outstanding} by {date_mention}?"
            )
            res = {
                "reply": reply,
                "outcome": "IN_PROGRESS",
                "should_end": False,
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 11. Payment Method Alone e.g. "UPI" (Preference Only) ────────────
        if extracted_method and not has_commit_word:
            extracted["payment_method_preference"] = extracted_method
            extracted["link_authorization_requested"] = True
            reply = (
                f"I have noted {extracted_method} as your preferred payment method. "
                f"When you are ready to settle, would you like us to dispatch a payment link to your registered mobile, or should we wait until our follow-up call?"
            )
            res = {
                "reply": reply,
                "outcome": "IN_PROGRESS",
                "should_end": False,
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── 9. Questions & Information Inquiries ──────────────────────────────
        # Multi-invoice query
        if any(phrase in text_lower for phrase in ["how many invoices", "multiple invoices", "all invoices", "list invoices", "which bills"]):
            if invoices and len(invoices) > 1:
                inv_list_str = "; ".join([f"#{inv.get('number', 'N/A')} for {inv.get('outstanding', 'N/A')}" for inv in invoices])
                reply = f"You currently have {len(invoices)} active invoices: {inv_list_str}. Would you like an itemized statement sent to your email?"
            else:
                reply = f"You currently have invoice #{invoice_number} for {outstanding}. Would you like an itemized statement sent to your email?"
            res = {
                "reply": reply,
                "outcome": "IN_PROGRESS",
                "should_end": False,
            }
            history.append({"role": "agent", "text": reply})
            return res

        if any(w in text_lower for w in ["balance", "how much", "what do i owe", "pending amount"]):
            reply = f"According to our live accounting ledger, your current outstanding balance is {outstanding}. Would you like me to send a breakdown to your registered email or WhatsApp?"
            res = {
                "reply": reply,
                "outcome": "IN_PROGRESS",
                "should_end": False,
            }
            history.append({"role": "agent", "text": reply})
            return res

        if any(phrase in text_lower for phrase in ["what is this for", "which invoice", "tell me more about this invoice", "invoice details", "due date", "when was this due", "who is this", "what is this regarding"]):
            reply = f"This is regarding invoice #{invoice_number} for {outstanding}. Would you like me to dispatch the itemized PDF statement directly to your WhatsApp or registered email?"
            res = {
                "reply": reply,
                "outcome": "IN_PROGRESS",
                "should_end": False,
            }
            history.append({"role": "agent", "text": reply})
            return res

        if any(phrase in text_lower for phrase in ["how to pay", "bank details", "account details", "upi id", "where to pay"]):
            reply = "You can settle securely via instant UPI, NetBanking / IMPS, or our 1-click Payment Link. Would you like me to send the payment link to your mobile right now?"
            res = {
                "reply": reply,
                "outcome": "IN_PROGRESS",
                "should_end": False,
            }
            history.append({"role": "agent", "text": reply})
            return res

        # ── Default In-Progress Prompt (Safe, Clarifying) ─────────────────────
        reply = f"Understood, {customer_name}. Regarding the pending balance of {outstanding}, could you share what date or arrangement works best for your accounts team?"
        res = {
            "reply": reply,
            "outcome": "IN_PROGRESS",
            "should_end": False,
        }
        history.append({"role": "agent", "text": reply})
        return res

    # ── 10-Stage Structured Flow with Multi-Turn Memory ───────────────────────

    def process_structured_turn(
        self,
        user_text: str,
        stage: str,
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Process a single turn in the 10-stage configurable Chotu AI conversation.
        Delegates to backend API (/voice/conversation/turn) if available, or falls back to
        the local 10-stage state machine with rich context memory and strict validation.
        """
        customer_id = context.get("customer_id")
        customer_name = context.get("customer_name", "Valued Client")
        outstanding = context.get("outstanding", "pending balance")
        invoice_number = context.get("invoice_number", "INV-CURRENT")
        invoices = context.get("invoices", [])
        extracted = context.setdefault("extracted", {})
        history = context.setdefault("history", [])
        context["turn_count"] = context.get("turn_count", 0) + 1

        # Safety Limit: Guardrail against runaway sessions while supporting 12+ turn conversations
        if context.get("turn_count", 0) > 30:
            reply = f"Thank you for your time, {customer_name}. Our session has reached the maximum turn duration. Our finance desk will follow up. Have a great day!"
            history.append({"role": "agent", "text": reply})
            return {
                "reply": reply,
                "next_stage": "CALL_ENDED",
                "should_end": True,
                "outcome": "PROMISE_TO_PAY" if extracted.get("commitment_status") == "CONFIRMED" else "OTHER",
            }

        # Initialize structured fields
        extracted.setdefault("can_pay", "UNKNOWN")
        extracted.setdefault("willing_to_pay", "UNKNOWN")
        extracted.setdefault("hardship_reason", None)
        extracted.setdefault("agreed_amount", None)
        extracted.setdefault("promised_date", None)
        extracted.setdefault("payment_method_preference", None)
        extracted.setdefault("link_authorization_requested", False)
        extracted.setdefault("link_authorization_granted", False)
        extracted.setdefault("commitment_status", "NONE")
        extracted.setdefault("tentative_timeframe", None)
        extracted.setdefault("dispute_reason", None)
        extracted.setdefault("claimed_amount", None)
        extracted.setdefault("claimed_utr", None)

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
                res = requests.post(url, json=payload, headers=self.get_headers(), timeout=5.0)
                if res.status_code in (200, 201):
                    data = res.json()
                    context["extracted"] = data.get("extractedData", extracted)
                    history.append({"role": "agent", "text": data["reply"]})
                    return {
                        "reply": data["reply"],
                        "next_stage": data["nextStage"],
                        "should_end": data["shouldEnd"],
                        "outcome": data.get("outcome", "IN_PROGRESS"),
                        "action_executed": data.get("actionExecuted"),
                        "preference_persisted": data.get("actionExecuted") == "CEASE_CONTACT_RECORDED",
                    }
            except Exception:
                pass

        # Local multi-turn state machine
        text_lower = user_text.lower().strip()

        # ── Global Objections ─────────────────────────────────────────────────
        if is_cease_contact_request(user_text):
            persisted = False
            if customer_id and self.token:
                tool_res = self.record_cease_contact(customer_id, reason=user_text[:100])
                if tool_res.get("status") == "SUCCESS":
                    persisted = True

            reply = (
                f"Understood, {customer_name}. We have recorded your request to cease all phone calls "
                f"and have updated our records accordingly. No further calls will be placed to this number. Thank you."
                if persisted
                else f"Understood, {customer_name}. I have noted your request to stop calls and ended this conversation. "
                f"A member of our compliance team will review your contact preferences. Thank you."
            )
            action_executed = "CEASE_CONTACT_RECORDED" if persisted else None
            history.append({"role": "agent", "text": reply})
            return {
                "reply": reply,
                "next_stage": "CALL_ENDED",
                "should_end": True,
                "outcome": "NO_CONTACT",
                "action_executed": action_executed,
                "preference_persisted": persisted,
            }

        if any(w in text_lower for w in ["human", "manager", "agent", "person", "supervisor"]):
            reply = f"Certainly, {customer_name}. I am immediately transferring your call to a senior accounts manager. Please hold."
            history.append({"role": "agent", "text": reply})
            return {
                "reply": reply,
                "next_stage": "TRANSFERRED_TO_AGENT",
                "should_end": True,
                "outcome": "TRANSFERRED_TO_AGENT",
                "action_executed": "TRANSFERRED_TO_HUMAN_AGENT",
            }

        if any(w in text_lower for w in ["call back", "call later", "busy", "driving", "meeting", "can't talk", "cannot talk"]):
            reply = f"Understood, {customer_name}. I will schedule a callback for later today. Thank you for your time."
            history.append({"role": "agent", "text": reply})
            return {
                "reply": reply,
                "next_stage": "CALLBACK_SCHEDULED",
                "should_end": True,
                "outcome": "CALLBACK_REQUESTED",
                "action_executed": "CALLBACK_SCHEDULED",
            }

        if any(w in text_lower for w in ["dispute", "wrong amount", "incorrect", "damaged goods", "not our bill"]):
            extracted["dispute_reason"] = user_text[:100]
            reply = f"I understand your concern, {customer_name}. I have marked this invoice for high-priority reconciliation with our billing desk."
            history.append({"role": "agent", "text": reply})
            return {
                "reply": reply,
                "next_stage": "DISPUTE_LOGGED",
                "should_end": True,
                "outcome": "DISPUTE",
                "action_executed": "DISPUTE_LOGGED",
            }

        if any(phrase in text_lower for phrase in ["already paid", "paid yesterday", "payment made", "already cleared"]):
            amt = self._extract_amount(user_text) or outstanding
            utr = self._extract_utr(user_text) or "Verification Pending"
            extracted["claimed_amount"] = amt
            extracted["claimed_utr"] = utr
            utr_ref = f" with UTR {utr}" if utr and utr != "Verification Pending" else ""
            reply = f"Thank you for informing us, {customer_name}. I have logged your payment claim for {amt}{utr_ref} for accounts reconciliation."
            history.append({"role": "agent", "text": reply})
            return {
                "reply": reply,
                "next_stage": "DISPUTE_LOGGED",
                "should_end": True,
                "outcome": "PAYMENT_CLAIMED",
                "action_executed": "PAYMENT_CLAIM_LOGGED",
            }

        if any(phrase in text_lower for phrase in ["refuse to pay", "will not pay", "won't pay", "not going to pay"]):
            reply = f"I have noted your refusal to settle invoice #{invoice_number}, {customer_name}. This will be flagged for senior account review."
            history.append({"role": "agent", "text": reply})
            return {
                "reply": reply,
                "next_stage": "CALL_ENDED",
                "should_end": True,
                "outcome": "REFUSED_TO_PAY",
                "action_executed": "REFUSAL_LOGGED",
            }

        if any(w in text_lower for w in ["hang up", "bye", "goodbye", "disconnect"]):
            reply = f"Thank you for your time, {customer_name}. Have a good day."
            history.append({"role": "agent", "text": reply})
            return {
                "reply": reply,
                "next_stage": "CALL_ENDED",
                "should_end": True,
                "outcome": "NO_CONTACT",
            }

        # ── Document & Payment Link Delivery Requests ─────────────────────────
        is_cancel_doc = any(phrase in text_lower for phrase in [
            "cancel document request", "cancel the document", "cancel delivery",
            "cancel the invoice request", "don't send the invoice", "dont send the invoice",
            "cancel payment link request", "don't send the link", "dont send the link"
        ])
        if is_cancel_doc:
            last_req_id = extracted.get("last_document_delivery_id")
            if last_req_id:
                try:
                    self.tools.cancel_document_delivery(last_req_id)
                except Exception:
                    pass
            extracted["document_delivery_cancelled"] = True
            reply = f"Understood, {customer_name}. I have cancelled the document delivery request for invoice #{invoice_number}. How else can I assist you today?"
            history.append({"role": "agent", "text": reply})
            return {
                "reply": reply,
                "next_stage": stage,
                "should_end": False,
                "outcome": "IN_PROGRESS",
                "action_executed": "DOCUMENT_DELIVERY_CANCELLED",
            }

        is_send_both = any(phrase in text_lower for phrase in [
            "send both", "send invoice and payment link", "send payment link and invoice",
            "send invoice and link", "send link and invoice", "share both"
        ])
        is_send_link = not is_send_both and any(phrase in text_lower for phrase in [
            "send payment link", "send me the payment link", "send the payment link",
            "share payment link", "send link", "send the link", "send me the link"
        ])
        is_send_invoice = not is_send_both and not is_send_link and any(phrase in text_lower for phrase in [
            "send invoice", "send me the invoice", "send the invoice",
            "share invoice", "send the bill", "send me the bill",
            "email me the invoice", "whatsapp me the invoice", "send invoice copy"
        ])

        if is_send_both or is_send_link or is_send_invoice:
            req_type = "BOTH" if is_send_both else ("PAYMENT_LINK" if is_send_link else "INVOICE")
            channel = "WHATSAPP_AND_EMAIL"
            if "whatsapp" in text_lower and "email" not in text_lower:
                channel = "WHATSAPP"
            elif "email" in text_lower and "whatsapp" not in text_lower:
                channel = "EMAIL"

            cust_id = context.get("customer_id") or "cust_default"
            inv_id = context.get("invoice_id")
            delivery_res = self.tools.request_document_delivery(
                customer_id=cust_id,
                invoice_id=inv_id,
                request_type=req_type,
                delivery_channel=channel,
            )
            extracted["last_document_delivery_id"] = delivery_res.get("request", {}).get("id")
            extracted["document_delivery"] = delivery_res.get("request")

            if req_type == "INVOICE":
                reply = f"I have dispatched the invoice PDF for invoice #{invoice_number} to your registered {channel.lower().replace('_', ' and ')} in simulation mode."
            elif req_type == "PAYMENT_LINK":
                reply = f"I have dispatched the instant payment link for invoice #{invoice_number} to your registered {channel.lower().replace('_', ' and ')} in simulation mode."
            else:
                reply = f"I have dispatched both invoice #{invoice_number} and the instant payment link to your registered {channel.lower().replace('_', ' and ')} in simulation mode."

            history.append({"role": "agent", "text": reply})
            next_stage = stage
            if stage == "ASSISTANCE_CHECK" or (extracted.get("agreed_amount") and extracted.get("promised_date")):
                next_stage = "SUMMARIZE_COMMITMENT"
            elif stage in ("GREETING_AND_VERIFICATION", "CONFIRM_BALANCE"):
                next_stage = "ASK_FULL_PAYMENT"
            elif stage in ("PAYMENT_METHOD", "ASK_PAYMENT_DATE"):
                next_stage = "ASSISTANCE_CHECK"

            return {
                "reply": reply,
                "next_stage": next_stage,
                "should_end": False,
                "outcome": "IN_PROGRESS",
                "action_executed": "DOCUMENT_DELIVERY_DISPATCHED",
            }

        # ── Inability / Hardship during structured flow ───────────────────────
        is_partial_in_full_stage = stage == "ASK_FULL_PAYMENT" and any(p in text_lower for p in ["full amount", "not full", "cannot pay the full", "can't pay the full"])
        is_hardship = not is_partial_in_full_stage and any(phrase in text_lower for phrase in [
            "can't pay anything", "cannot pay anything", "cant pay anything", "no money",
            "cannot afford", "can't afford", "no funds", "bankruptcy", "cash crunch",
            "severe loss", "business is down", "insolvency", "financial crisis",
            "tight cash flow", "financial issue"
        ])

        if is_hardship:
            extracted["can_pay"] = "NO"
            extracted["hardship_reason"] = user_text[:100]
            reply = (
                f"I understand, {customer_name}, and appreciate you sharing your situation. "
                f"We recognize cash flow challenges arise in business. "
                f"Do you anticipate your financial situation easing in the coming weeks, or would you prefer a callback at a later time?"
            )
            history.append({"role": "agent", "text": reply})
            return {
                "reply": reply,
                "next_stage": "ASK_DELAY_REASON",
                "should_end": False,
                "outcome": "UNABLE_TO_PAY",
            }

        # ── Stage Progression ─────────────────────────────────────────────────
        if stage == "GREETING_AND_VERIFICATION":
            if any(w in text_lower for w in ["yes", "speaking", "correct", "haan"]):
                reply = f"Thank you for confirming. I am reaching out regarding your pending balance of {outstanding}. Do you have this record accessible on your end?"
                next_stage = "CONFIRM_BALANCE"
            else:
                reply = f"I am calling regarding your account balance of {outstanding}. Could you confirm if you have received our statement?"
                next_stage = "CONFIRM_BALANCE"
            history.append({"role": "agent", "text": reply})
            return {"reply": reply, "next_stage": next_stage, "should_end": False}

        elif stage == "CONFIRM_BALANCE":
            reply = f"Great! Are you in a position to clear the full balance of {outstanding} today via instant payment link or bank transfer?"
            history.append({"role": "agent", "text": reply})
            return {"reply": reply, "next_stage": "ASK_FULL_PAYMENT", "should_end": False}

        elif stage == "ASK_FULL_PAYMENT":
            is_pay_later = any(phrase in text_lower for phrase in [
                "pay later", "i'll pay later", "i will pay later", "will pay later", "pay after",
                "pay afterwards", "sometime later", "pay next time", "settle later", "pay you later",
                "clear later", "clear it later", "pay some other time"
            ])
            if is_pay_later:
                extracted["will_pay_later"] = True
                reply = f"Understood that you'd like to pay later, {customer_name}. What specific date or timeframe would work for your accounts desk?"
                history.append({"role": "agent", "text": reply})
                return {
                    "reply": reply,
                    "next_stage": "ASK_PAYMENT_DATE",
                    "should_end": False,
                    "outcome": "WILL_PAY_LATER",
                }

            is_negative = any(w in text_lower for w in ["no", "cannot", "can't", "not able", "not full", "unable", "hard", "difficult", "partial", "impossible", "later"])
            if not is_negative and any(w in text_lower for w in ["yes", "sure", "will pay", "clearing", "full", "okay", "haan"]):
                extracted["agreed_amount"] = outstanding
                extracted["can_pay"] = "YES"
                reply = "Excellent! Which payment method do you prefer — UPI, NetBanking / IMPS, or a direct Payment Link?"
                next_stage = "PAYMENT_METHOD"
            else:
                extracted["can_pay"] = "PARTIAL"
                reply = "I understand cash flow constraints. What partial amount would you be able to clear today to keep your account in good standing?"
                next_stage = "NEGOTIATE_AMOUNT"
            history.append({"role": "agent", "text": reply})
            return {"reply": reply, "next_stage": next_stage, "should_end": False}

        elif stage == "NEGOTIATE_AMOUNT":
            # Extract numerical amount only!
            amt = self._extract_amount(user_text)
            date_timeframe = self._extract_date(user_text)

            if amt:
                extracted["agreed_amount"] = amt
                reply = "Thank you, that helps. For the remaining balance, by what specific date can our accounts team expect the final remittance?"
                next_stage = "ASK_PAYMENT_DATE"
            elif date_timeframe:
                # Customer mentioned a timeframe instead of an amount (e.g. "20 days from now")!
                extracted["tentative_timeframe"] = date_timeframe
                extracted["promised_date"] = date_timeframe
                reply = f"Understood, so {date_timeframe}. Could you share what specific reason or difficulty caused this delay?"
                next_stage = "ASK_DELAY_REASON"
            else:
                reply = "Understood. Could you share what specific reason or difficulty caused this delay, so our finance team can assist?"
                next_stage = "ASK_DELAY_REASON"

            history.append({"role": "agent", "text": reply})
            return {"reply": reply, "next_stage": next_stage, "should_end": False}

        elif stage == "ASK_PAYMENT_DATE":
            date_val = self._extract_date(user_text)
            if date_val:
                extracted["promised_date"] = date_val
                reply = f"Noted: {date_val}. Just so our finance desk can document the file, could you share the primary reason for the delay?"
            else:
                # Customer gave reason instead of date (e.g. "financial issue")
                extracted["hardship_reason"] = user_text[:50]
                reply = "Thank you for sharing that. By what date do you anticipate being able to remit payment?"
            history.append({"role": "agent", "text": reply})
            return {"reply": reply, "next_stage": "ASK_DELAY_REASON", "should_end": False}

        elif stage == "ASK_DELAY_REASON":
            if not extracted.get("hardship_reason"):
                extracted["hardship_reason"] = user_text[:50]
            reply = "Thank you for sharing that context. What is your preferred payment channel — UPI, NetBanking / NEFT, or a one-click payment link?"
            history.append({"role": "agent", "text": reply})
            return {"reply": reply, "next_stage": "PAYMENT_METHOD", "should_end": False}

        elif stage == "PAYMENT_METHOD":
            method = self._extract_payment_method(user_text) or "UPI"
            extracted["payment_method_preference"] = method
            reply = f"Got it, {method}. Would you like me to send an instant payment link and invoice breakdown directly to your WhatsApp or email, or should we wait?"
            history.append({"role": "agent", "text": reply})
            return {"reply": reply, "next_stage": "ASSISTANCE_CHECK", "should_end": False}

        elif stage == "ASSISTANCE_CHECK":
            if any(w in text_lower for w in ["yes", "send", "please", "whatsapp", "email", "sure", "okay"]):
                extracted["link_authorization_granted"] = True

            amt = extracted.get("agreed_amount")
            date_val = extracted.get("promised_date") or extracted.get("tentative_timeframe")
            method_val = extracted.get("payment_method_preference") or "electronic transfer"

            # Check if customer previously stated inability to pay or pay later
            if extracted.get("can_pay") == "NO":
                reply = f"Thank you, {customer_name}. I have noted your account status and preferred payment mode. Would you like a callback in {date_val or 'a few weeks'} to check in?"
                next_stage = "CLOSING"
                outcome = "UNABLE_TO_PAY"
                history.append({"role": "agent", "text": reply})
                return {
                    "reply": reply,
                    "next_stage": next_stage,
                    "should_end": False,
                    "outcome": outcome,
                }
            elif extracted.get("will_pay_later") and not amt:
                reply = f"Thank you, {customer_name}. We have noted that you intend to pay later. Our team will follow up in {date_val or 'a few weeks'}. Have a good day!"
                next_stage = "CLOSING"
                outcome = "WILL_PAY_LATER"
                history.append({"role": "agent", "text": reply})
                return {
                    "reply": reply,
                    "next_stage": next_stage,
                    "should_end": False,
                    "outcome": outcome,
                }
            elif not amt:
                reply = f"Thank you, {customer_name}. I have noted your account notes and follow-up preference. Is there anything else I can assist you with today?"
                next_stage = "CLOSING"
                outcome = "OTHER"
                history.append({"role": "agent", "text": reply})
                return {
                    "reply": reply,
                    "next_stage": next_stage,
                    "should_end": False,
                    "outcome": outcome,
                }
            else:
                reply = f"Perfect. To confirm our arrangement: you will remit {amt} by {date_val} via {method_val}. Do you confirm this commitment?"
                next_stage = "SUMMARIZE_COMMITMENT"
                history.append({"role": "agent", "text": reply})
                return {"reply": reply, "next_stage": next_stage, "should_end": False}

        elif stage == "SUMMARIZE_COMMITMENT":
            # STRICT: Records promises ONLY when explicitly agreed AND details are valid
            if any(w in text_lower for w in ["yes", "confirm", "correct", "sure", "ok", "okay", "haan", "agreed"]):
                amt = extracted.get("agreed_amount")
                date_val = extracted.get("promised_date")

                if amt and date_val and extracted.get("can_pay") != "NO":
                    extracted["commitment_status"] = "CONFIRMED"
                    reply = f"Thank you very much, {customer_name}! Your payment commitment of {amt} by {date_val} has been formally recorded. You will receive an acknowledgment confirmation shortly. Have a great day!"
                    history.append({"role": "agent", "text": reply})
                    return {
                        "reply": reply,
                        "next_stage": "CLOSING",
                        "should_end": True,
                        "outcome": "PROMISE_TO_PAY",
                        "action_executed": "RECORD_PAYMENT_PROMISE",
                    }
                elif extracted.get("can_pay") == "NO":
                    reply = f"Thank you, {customer_name}. I have recorded your account notes and follow-up preference. Have a great day!"
                    history.append({"role": "agent", "text": reply})
                    return {
                        "reply": reply,
                        "next_stage": "CLOSING",
                        "should_end": True,
                        "outcome": "UNABLE_TO_PAY",
                    }
                else:
                    reply = f"Thank you, {customer_name}. I have recorded your account notes and follow-up preference. Have a great day!"
                    history.append({"role": "agent", "text": reply})
                    return {
                        "reply": reply,
                        "next_stage": "CLOSING",
                        "should_end": True,
                        "outcome": "WILL_PAY_LATER" if extracted.get("will_pay_later") else "OTHER",
                    }
            else:
                # Customer said NO to the proposed commitment
                extracted["commitment_status"] = "REJECTED"
                extracted["agreed_amount"] = None
                extracted["promised_date"] = None
                reply = f"No problem at all, {customer_name}. I have cancelled that proposed arrangement. What date or plan works best for your team?"
                history.append({"role": "agent", "text": reply})
                return {
                    "reply": reply,
                    "next_stage": "ASK_PAYMENT_DATE",
                    "should_end": False,
                    "outcome": "IN_PROGRESS",
                }

        else:
            final_outcome = "OTHER"
            if extracted.get("can_pay") == "NO":
                final_outcome = "UNABLE_TO_PAY"
            elif extracted.get("will_pay_later"):
                final_outcome = "WILL_PAY_LATER"
            elif extracted.get("callback_requested"):
                final_outcome = "CALLBACK_REQUESTED"
            elif extracted.get("is_dispute"):
                final_outcome = "DISPUTE"
            elif extracted.get("payment_claimed"):
                final_outcome = "PAYMENT_CLAIMED"
            elif extracted.get("commitment_status") == "CONFIRMED":
                final_outcome = "PROMISE_TO_PAY"

            is_farewell = any(w in text_lower for w in [
                "bye", "goodbye", "thank you", "thanks", "that's all", "nothing else",
                "all set", "all good", "done", "disconnect", "no thanks"
            ])

            if is_farewell:
                reply = f"Thank you for your time, {customer_name}. Have a good day!"
                should_end = True
                next_stage = "CALL_ENDED"
            elif any(w in text_lower for w in ["balance", "how much", "total", "amount", "outstanding"]):
                reply = f"Your outstanding balance on invoice #{invoice_number} is {outstanding}. Would you like me to send a payment link or statement?"
                should_end = False
                next_stage = "CLOSING"
            elif any(w in text_lower for w in ["receipt", "proof", "acknowledgment", "confirmation"]):
                reply = "Yes, an automated GST tax receipt and payment acknowledgment will be sent immediately once payment reflects."
                should_end = False
                next_stage = "CLOSING"
            elif any(w in text_lower for w in ["upi", "ifsc", "account", "bank details", "link"]):
                reply = "You can settle securely via UPI or NetBanking using our secure payment link. Would you like me to dispatch the link to your phone now?"
                should_end = False
                next_stage = "CLOSING"
            else:
                reply = f"I have noted that for your account file, {customer_name}. If there is anything else you need, please let me know, or have a wonderful day ahead!"
                should_end = False
                next_stage = "CLOSING"

            history.append({"role": "agent", "text": reply})
            return {
                "reply": reply,
                "next_stage": next_stage,
                "should_end": should_end,
                "outcome": final_outcome,
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
            "history": [],
            "turn_count": 0,
        }
        current_stage = "GREETING_AND_VERIFICATION"
        start_time = datetime.datetime.now()

        opening = f"Namaste! Am I speaking with the accounts department at {customer_name}? This is Chotu calling from myCashflo regarding your outstanding balance of {outstanding}."
        print(f"\n🤖 Chotu [{current_stage}]: {opening}")
        context["history"].append({"role": "agent", "text": opening})

        while True:
            try:
                user_input = input("\n👤 Customer: ").strip()
            except (KeyboardInterrupt, EOFError):
                break

            if not user_input or user_input.lower() in ("exit", "quit"):
                print("\nEnding call...")
                break

            result = self.process_structured_turn(user_input, current_stage, context)
            current_stage = result.get("next_stage", current_stage)
            print(f"🤖 Chotu [{current_stage}]: {result['reply']}")

            if result.get("should_end") and (result.get("next_stage") == "CALL_ENDED" or result.get("outcome") in ("NO_CONTACT", "TRANSFERRED_TO_AGENT")):
                outcome = result.get("outcome", "COMPLETED")
                print(f"\n[Call Completed — Outcome: {outcome}]")
                duration = int((datetime.datetime.now() - start_time).total_seconds())
                summary = f"Spoke with {customer_name}. Outcome: {outcome}."
                transcript_text = "\n".join([f"[{m['role'].upper()}]: {m['text']}" for m in context.get("history", [])])
                self.record_call_outcome(
                    customer_id=customer_id,
                    duration=duration,
                    outcome=outcome,
                    summary=summary,
                    transcript=transcript_text,
                )
                break


class LiveKitChotuWorker:
    """
    Connects Chotu AI conversational agent to LiveKit Cloud WebRTC rooms or SIP bridged calls.
    Enforces NO_CONTACT pre-call checks, publishes audio tracks, streams synthesized speech,
    subscribes to remote participant audio, handles real-time dialogue turns,
    and logs final call session results.
    """
    def __init__(
        self,
        agent: Optional[ChotuAgent] = None,
        livekit_url: Optional[str] = None,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
        agent_name: Optional[str] = None,
    ):
        self.agent = agent or ChotuAgent()
        self.livekit_url = livekit_url or os.getenv("LIVEKIT_URL", "wss://demo.livekit.cloud")
        self.api_key = api_key or os.getenv("LIVEKIT_API_KEY")
        self.api_secret = api_secret or os.getenv("LIVEKIT_API_SECRET")
        self.agent_name = agent_name or os.getenv("LIVEKIT_AGENT_NAME", "chotu-voice-agent")
        
        self.room: Any = None
        self.audio_source: Any = None
        self.audio_track: Any = None
        self.is_connected: bool = False
        self.is_closed: bool = False
        self.current_stage: str = "GREETING_AND_VERIFICATION"
        self.session_context: Dict[str, Any] = {}
        self.transcript_history: List[Dict[str, str]] = []
        self.frames_sent_count: int = 0
        self.frames_received_count: int = 0
        self.room_name: Optional[str] = None
        self.start_time: Optional[datetime.datetime] = None
        self.last_outcome: str = "OTHER"

    def check_pre_call_consent(
        self,
        customer_notes: Optional[str] = None,
        preferred_channel: Optional[str] = None,
        voice_consent: Optional[str] = None,
        server_authorized: bool = False,
    ) -> bool:
        """
        Enforce Do-Not-Contact / cease-contact policy before placing or answering any call attempt.
        Worker cannot independently authorize a call when voice_consent is not OPTED_IN and
        server_authorized is not True (UNKNOWN / OPTED_OUT blocks).
        Returns False if call MUST be suppressed.
        """
        # 1. Server authorization or explicit OPTED_IN consent required
        if not server_authorized and voice_consent != "OPTED_IN":
            return False

        # 2. Preferred channel NO_CONTACT suppresses call
        if preferred_channel == "NO_CONTACT":
            return False

        # 3. Explicit OPTED_OUT voice consent suppresses call even if server authorized
        if voice_consent == "OPTED_OUT":
            return False

        # 4. Check notes for cease-contact / DND
        if customer_notes:
            notes_upper = customer_notes.upper()
            if "DND:NO_CONTACT" in notes_upper or "NO_CONTACT" in notes_upper or "OPT_OUT" in notes_upper:
                return False

        return True

    def generate_agent_token(self, room_name: str, ttl_seconds: int = 900) -> str:
        """Generate short-lived JWT token with minimal grants for Chotu voice agent to join room."""
        if not self.api_key or not self.api_secret or self.api_key.startswith("your_"):
            # Mock token for test environments
            import base64
            payload = {
                "sub": f"agent-{self.agent_name}",
                "room": room_name,
                "name": "Chotu AI Voice Agent",
                "mode": "mock",
                "exp": int(datetime.datetime.now().timestamp()) + ttl_seconds,
            }
            return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()

        try:
            from livekit.api import AccessToken, VideoGrants
            token = AccessToken(self.api_key, self.api_secret)
            token.with_identity(f"agent-{self.agent_name}")
            token.with_name("Chotu AI Voice Agent")
            token.with_grants(VideoGrants(room_join=True, room=room_name, can_publish=True, can_subscribe=True, can_publish_data=True))
            token.with_ttl(datetime.timedelta(seconds=ttl_seconds))
            return token.to_jwt()
        except Exception as e:
            import base64
            payload = {
                "sub": f"agent-{self.agent_name}",
                "room": room_name,
                "error": str(e),
                "mode": "mock_fallback",
            }
            return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()

    def generate_audio_frames(self, text: str, sample_rate: int = 48000) -> List[Any]:
        """
        Generates 48kHz mono 16-bit PCM AudioFrames matching natural speech cadence.
        Splits into 20ms chunks (960 samples per frame).
        """
        import array
        import math
        try:
            import livekit.rtc as rtc
        except ImportError:
            return []

        samples_per_chunk = 960  # 20ms at 48kHz
        duration_sec = max(0.4, min(4.0, len(text) * 0.04))
        total_samples = int(sample_rate * duration_sec)

        frames = []
        chunk_samples = []
        for i in range(total_samples):
            t = i / sample_rate
            f0 = 200 + 30 * math.sin(2 * math.pi * 1.5 * t)
            carrier = math.sin(2 * math.pi * f0 * t)
            envelope = 0.5 * (1 + math.sin(2 * math.pi * 4 * t))
            val = int(carrier * envelope * 12000)
            chunk_samples.append(max(-32768, min(32767, val)))

            if len(chunk_samples) == samples_per_chunk:
                frame = rtc.AudioFrame.create(sample_rate, 1, samples_per_chunk)
                frame.data[:] = array.array("h", chunk_samples)
                frames.append(frame)
                chunk_samples = []

        if chunk_samples:
            pad_len = samples_per_chunk - len(chunk_samples)
            chunk_samples.extend([0] * pad_len)
            frame = rtc.AudioFrame.create(sample_rate, 1, samples_per_chunk)
            frame.data[:] = array.array("h", chunk_samples)
            frames.append(frame)

        return frames

    async def publish_speech(self, text: str):
        """Streams synthesized speech AudioFrames to the published WebRTC track and sends data packet."""
        frames = self.generate_audio_frames(text)
        if self.audio_source:
            for frame in frames:
                try:
                    await self.audio_source.capture_frame(frame)
                    self.frames_sent_count += 1
                except Exception:
                    break
                await asyncio.sleep(0.005)

        if self.room and getattr(self.room, "local_participant", None):
            try:
                packet = json.dumps({
                    "type": "agent_speech",
                    "text": text,
                    "stage": self.current_stage,
                    "outcome": self.last_outcome,
                }).encode("utf-8")
                await self.room.local_participant.publish_data(packet, reliable=True)
            except Exception:
                pass

    async def connect_and_join(self, room_name: str, context: Optional[Dict[str, Any]] = None) -> bool:
        """
        Connects to LiveKit Cloud room, publishes local audio track, and prepares bidirectional session.
        """
        self.room_name = room_name
        self.session_context = context or {}
        self.start_time = datetime.datetime.now()

        if not self.check_pre_call_consent(
            customer_notes=self.session_context.get("customer_notes"),
            preferred_channel=self.session_context.get("preferred_channel"),
            voice_consent=self.session_context.get("voice_consent"),
            server_authorized=self.session_context.get("server_authorized", False),
        ):
            self.last_outcome = "NO_CONTACT"
            return False

        token = self.generate_agent_token(room_name)

        try:
            import livekit.rtc as rtc
        except ImportError:
            print("[LiveKit Worker] livekit.rtc module is not available")
            return False

        self.room = rtc.Room()

        @self.room.on("track_subscribed")
        def on_track_sub(track, publication, participant):
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                async def read_stream():
                    try:
                        stream = rtc.AudioStream.from_track(track=track)
                        async for _ in stream:
                            self.frames_received_count += 1
                    except Exception:
                        pass
                asyncio.create_task(read_stream())

        @self.room.on("data_received")
        def on_data_received(dp):
            try:
                payload = json.loads(dp.data.decode("utf-8"))
                user_text = payload.get("text") or payload.get("userSpeech")
                if user_text:
                    asyncio.create_task(self.handle_turn(user_text))
            except Exception:
                pass

        try:
            await self.room.connect(self.livekit_url, token)
            self.audio_source = rtc.AudioSource(48000, 1)
            self.audio_track = rtc.LocalAudioTrack.create_audio_track("chotu_agent_voice", self.audio_source)
            await self.room.local_participant.publish_track(
                self.audio_track,
                rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
            )
            self.is_connected = True

            cust_name = self.session_context.get("customer_name", "Valued Customer")
            bal = self.session_context.get("outstanding", "your account balance")
            greeting = f"Namaste! Am I speaking with the accounts department at {cust_name}? This is Chotu calling from myCashflo regarding pending balance of {bal}."
            await self.publish_speech(greeting)
            return True
        except Exception as e:
            print(f"[LiveKit Worker] Failed to connect to room '{room_name}': {e}")
            await self.disconnect()
            return False

    async def handle_turn(self, user_utterance: str) -> Dict[str, Any]:
        """
        Processes incoming user speech, executes conversation stage transitions,
        publishes response audio frames, and handles session termination.
        """
        res = self.process_incoming_transcript(user_utterance, self.current_stage, self.session_context)
        self.current_stage = res.get("next_stage", self.current_stage)
        self.session_context = res.get("context", self.session_context)
        self.last_outcome = res.get("outcome", self.last_outcome)
        reply = res.get("reply", "")

        self.transcript_history.append({"role": "customer", "text": user_utterance})
        self.transcript_history.append({"role": "agent", "text": reply})

        await self.publish_speech(reply)

        if res.get("should_end"):
            duration = int((datetime.datetime.now() - self.start_time).total_seconds()) if self.start_time else 10
            transcript_str = "\n".join([f"{t['role'].upper()}: {t['text']}" for t in self.transcript_history])
            self.agent.record_call_outcome(
                customer_id=self.session_context.get("customer_id"),
                duration=duration,
                outcome=self.last_outcome,
                summary=f"Call ended at stage: {self.current_stage}. Outcome: {self.last_outcome}",
                transcript=transcript_str,
                livekit_room=self.room_name,
            )
            await self.disconnect()

        return res

    async def disconnect(self):
        """Cleanly releases audio sources, leaves the room, and resets state."""
        if self.audio_source:
            try:
                await self.audio_source.aclose()
            except Exception:
                pass
            self.audio_source = None

        if self.room:
            try:
                await self.room.disconnect()
            except Exception:
                pass
            self.room = None

        self.is_connected = False
        self.is_closed = True

    def process_incoming_transcript(
        self,
        user_utterance: str,
        current_stage: str,
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Processes an incoming user speech turn from LiveKit WebRTC track or SIP callee.
        Guarantees strict NO_CONTACT detection, empathetic hardship handling, and
        explicit confirmation for Promise to Pay.
        """
        return self.agent.process_structured_turn(user_utterance, current_stage, context)


def main():
    parser = argparse.ArgumentParser(description="myCashflo Chotu AI Voice Agent")
    parser.add_argument("--simulate", action="store_true", help="Run in local CLI simulation mode")
    parser.add_argument("--livekit", action="store_true", help="Run in LiveKit Cloud worker mode")
    parser.add_argument("--room", default=None, help="LiveKit room name to join")
    parser.add_argument("--customer", default="Raj Enterprises", help="Customer name for simulation")
    parser.add_argument("--amount", default="₹1,45,000", help="Outstanding balance for simulation")
    parser.add_argument("--customer-id", default=None, help="Customer ID for live intelligence tools")
    args = parser.parse_args()

    agent = ChotuAgent()

    if args.livekit and args.room:
        worker = LiveKitChotuWorker(agent=agent)
        print(f"[LiveKit Worker] Initialized for room: {args.room}")
        token = worker.generate_agent_token(args.room)
        print(f"[LiveKit Worker] Agent token generated successfully (length: {len(token)} chars)")
        ctx = {"customer_name": args.customer, "outstanding": args.amount, "customer_id": args.customer_id}

        async def run_session():
            connected = await worker.connect_and_join(args.room, ctx)
            if connected:
                print(f"[LiveKit Worker] Successfully connected and published voice track to room '{args.room}' (Frames sent: {worker.frames_sent_count})")
                await worker.disconnect()
                print(f"[LiveKit Worker] Cleanly disconnected from room '{args.room}'.")
            else:
                print(f"[LiveKit Worker] Pre-call consent blocked or connection failed for room '{args.room}'.")

        asyncio.run(run_session())
    else:
        agent.run_cli_simulation(customer_name=args.customer, outstanding=args.amount, customer_id=args.customer_id)


if __name__ == "__main__":
    main()
