import unittest
from unittest.mock import patch, MagicMock
from agent import ChotuAgent

class TestChotuAgent(unittest.TestCase):
    def setUp(self):
        self.agent = ChotuAgent()
        self.agent.token = None  # Use fast local state machine in unit tests
        self.context = {
            "customer_name": "Acme Corp",
            "outstanding": "₹50,000",
        }

    def test_promise_to_pay_intent(self):
        res = self.agent.process_reply("We will pay this Friday by NEFT", self.context)
        self.assertEqual(res["outcome"], "PROMISE_TO_PAY")
        self.assertTrue(res["should_end"])
        self.assertIn("Acme Corp", res["reply"])

    def test_dispute_intent(self):
        res = self.agent.process_reply("There is a dispute, the amount is incorrect", self.context)
        self.assertEqual(res["outcome"], "DISPUTE")
        self.assertTrue(res["should_end"])

    def test_callback_intent(self):
        res = self.agent.process_reply("I am in a meeting, call later please", self.context)
        self.assertEqual(res["outcome"], "CALLBACK_REQUESTED")
        self.assertTrue(res["should_end"])

    def test_in_progress_conversation(self):
        res = self.agent.process_reply("Can you tell me more about this invoice?", self.context)
        self.assertEqual(res["outcome"], "IN_PROGRESS")
        self.assertFalse(res["should_end"])

    def test_balance_query_intent(self):
        res = self.agent.process_reply("What is my current balance?", self.context)
        self.assertEqual(res["outcome"], "IN_PROGRESS")
        self.assertIn("₹50,000", res["reply"])

    def test_consequential_confirmation_flow(self):
        # When awaiting confirmation, user confirms
        confirm_context = {
            "customer_name": "Acme Corp",
            "outstanding": "₹50,000",
            "awaiting_confirmation": True,
            "pending_action": "PROMISE_TO_PAY",
        }
        res = self.agent.process_reply("Yes, I confirm that", confirm_context)
        self.assertEqual(res["outcome"], "PROMISE_TO_PAY")
        self.assertTrue(res["should_end"])
        self.assertTrue(res.get("action_executed"))

    def test_consequential_confirmation_cancellation(self):
        # When awaiting confirmation, user says no
        cancel_context = {
            "customer_name": "Acme Corp",
            "outstanding": "₹50,000",
            "awaiting_confirmation": True,
            "pending_action": "PROMISE_TO_PAY",
        }
        res = self.agent.process_reply("No, wait, let me check with my manager", cancel_context)
        self.assertEqual(res["outcome"], "IN_PROGRESS")
        self.assertFalse(res["should_end"])
        self.assertFalse(cancel_context.get("awaiting_confirmation"))

    def test_execute_tool_success(self):
        with patch.object(self.agent, "execute_tool", return_value={"status": "SUCCESS", "toolName": "get_customer_balance"}):
            res = self.agent.get_customer_balance("cust_123")
            self.assertEqual(res.get("status"), "SUCCESS")

    def test_10_stage_structured_flow_happy_path(self):
        ctx = {"customer_name": "Acme Corp", "outstanding": "₹50,000", "extracted": {}}

        # Stage 1: Greeting
        t1 = self.agent.process_structured_turn("Yes, speaking, this is finance", "GREETING_AND_VERIFICATION", ctx)
        self.assertEqual(t1["next_stage"], "CONFIRM_BALANCE")
        self.assertFalse(t1["should_end"])

        # Stage 2: Balance confirmation
        t2 = self.agent.process_structured_turn("Yes, we have received this bill", "CONFIRM_BALANCE", ctx)
        self.assertEqual(t2["next_stage"], "ASK_FULL_PAYMENT")
        self.assertFalse(t2["should_end"])

        # Stage 3: Full payment (cannot pay full today)
        t3 = self.agent.process_structured_turn("No, we cannot pay the full amount today", "ASK_FULL_PAYMENT", ctx)
        self.assertEqual(t3["next_stage"], "NEGOTIATE_AMOUNT")
        self.assertFalse(t3["should_end"])

        # Stage 4: Negotiate partial amount
        t4 = self.agent.process_structured_turn("We can pay ₹25,000 right now", "NEGOTIATE_AMOUNT", ctx)
        self.assertEqual(t4["next_stage"], "ASK_PAYMENT_DATE")
        self.assertFalse(t4["should_end"])

        # Stage 5: Payment date for remainder
        t5 = self.agent.process_structured_turn("We will clear the rest by next Friday", "ASK_PAYMENT_DATE", ctx)
        self.assertEqual(t5["next_stage"], "ASK_DELAY_REASON")
        self.assertFalse(t5["should_end"])

        # Stage 6: Reason for delay
        t6 = self.agent.process_structured_turn("Client clearance was delayed", "ASK_DELAY_REASON", ctx)
        self.assertEqual(t6["next_stage"], "PAYMENT_METHOD")
        self.assertFalse(t6["should_end"])

        # Stage 7: Preferred payment method
        t7 = self.agent.process_structured_turn("We will transfer via UPI", "PAYMENT_METHOD", ctx)
        self.assertEqual(t7["next_stage"], "ASSISTANCE_CHECK")
        self.assertFalse(t7["should_end"])

        # Stage 8: Assistance / instant link check
        t8 = self.agent.process_structured_turn("Yes, please send the link on WhatsApp", "ASSISTANCE_CHECK", ctx)
        self.assertEqual(t8["next_stage"], "SUMMARIZE_COMMITMENT")
        self.assertFalse(t8["should_end"])

        # Stage 9: Summarize & lock commitment
        t9 = self.agent.process_structured_turn("Yes, I confirm that commitment", "SUMMARIZE_COMMITMENT", ctx)
        self.assertEqual(t9["next_stage"], "CLOSING")
        self.assertTrue(t9["should_end"])
        self.assertEqual(t9["outcome"], "PROMISE_TO_PAY")

    def test_structured_turn_agent_transfer_objection(self):
        ctx = {"customer_name": "Acme Corp", "outstanding": "₹50,000"}
        res = self.agent.process_structured_turn("Let me speak to a human manager please", "ASK_PAYMENT_DATE", ctx)
        self.assertEqual(res["next_stage"], "TRANSFERRED_TO_AGENT")
        self.assertTrue(res["should_end"])
        self.assertEqual(res["outcome"], "TRANSFERRED_TO_AGENT")

    # ── Cease-Contact (NO_CONTACT) Tests ────────────────────────────────────
    def test_direct_cease_contact_request(self):
        """Direct request: 'Stop calling me.' terminates call and returns NO_CONTACT."""
        res = self.agent.process_reply("Stop calling me.", self.context)
        self.assertEqual(res["outcome"], "NO_CONTACT")
        self.assertTrue(res["should_end"])
        # Must not ask for payment date or continue collection prompts
        self.assertNotIn("estimated date", res["reply"].lower())
        self.assertNotIn("remittance", res["reply"].lower())

    def test_natural_language_cease_contact_variations(self):
        """Equivalent natural-language variations trigger NO_CONTACT without collection prompts."""
        variations = [
            "Do not call this number again",
            "Please cease all contact immediately",
            "Remove my number from your database",
            "Put me on your do not call list",
            "Take me off your list right now",
            "I refuse to pay, never call me again",
            "Stop contacting me",
        ]
        for phrase in variations:
            with self.subTest(phrase=phrase):
                res = self.agent.process_reply(phrase, self.context)
                self.assertEqual(res["outcome"], "NO_CONTACT", f"Failed for phrase: '{phrase}'")
                self.assertTrue(res["should_end"], f"Failed to end call for: '{phrase}'")
                self.assertNotIn("estimated date", res["reply"].lower())

    def test_cease_contact_with_verified_backend_persistence(self):
        """When backend tool execution succeeds, agent confirms preference was recorded."""
        self.agent.token = "mock_jwt_token"
        ctx = {"customer_id": "cust_123", "customer_name": "Acme Corp", "outstanding": "₹50,000"}

        with patch.object(
            self.agent,
            "execute_tool",
            return_value={"status": "SUCCESS", "result": {"dndActive": True}},
        ) as mock_tool:
            res = self.agent.process_reply("Stop calling me please", ctx)

            mock_tool.assert_called_once_with(
                "record_cease_contact",
                {"customerId": "cust_123", "reason": "Stop calling me please", "channel": "ALL"},
                confirmed=True,
            )
            self.assertEqual(res["outcome"], "NO_CONTACT")
            self.assertTrue(res["should_end"])
            self.assertTrue(res["preference_persisted"])
            self.assertEqual(res["action_executed"], "CEASE_CONTACT_RECORDED")
            self.assertIn("recorded your request", res["reply"].lower())
            self.assertIn("no further calls", res["reply"].lower())

    def test_cease_contact_unconfirmed_persistence_does_not_falsely_claim_success(self):
        """When backend persistence cannot be confirmed, agent does NOT falsely claim it was saved."""
        self.agent.token = "mock_jwt_token"
        ctx = {"customer_id": "cust_123", "customer_name": "Acme Corp", "outstanding": "₹50,000"}

        # Simulate backend tool failure / offline API
        with patch.object(
            self.agent,
            "execute_tool",
            return_value={"status": "ERROR", "message": "Backend database unreachable"},
        ):
            res = self.agent.process_reply("Stop calling me", ctx)

            self.assertEqual(res["outcome"], "NO_CONTACT")
            self.assertTrue(res["should_end"])
            self.assertFalse(res["preference_persisted"])
            self.assertIsNone(res["action_executed"])
            # Does NOT falsely claim it was successfully saved in the system
            self.assertNotIn("recorded your request to cease all phone contact and have updated our records", res["reply"].lower())
            self.assertIn("compliance team will review", res["reply"].lower())

    def test_unclear_statements_do_not_trigger_no_contact(self):
        """Unclear or temporary unavailability statements must NOT be treated as confirmed DND."""
        unclear_inputs = [
            ("I can't talk right now, I'm driving", "CALLBACK_REQUESTED"),
            ("Please call back later this afternoon", "CALLBACK_REQUESTED"),
            ("I am in a meeting with a client", "CALLBACK_REQUESTED"),
            ("Can you tell me what this is regarding?", "IN_PROGRESS"),
            ("Who is this calling?", "IN_PROGRESS"),
        ]
        for utterance, expected_outcome in unclear_inputs:
            with self.subTest(utterance=utterance):
                res = self.agent.process_reply(utterance, self.context)
                self.assertEqual(res["outcome"], expected_outcome, f"Expected {expected_outcome} for '{utterance}'")
    def test_structured_turn_cease_contact_interruption(self):
        """Cease-contact interruption during structured 10-stage conversation transitions to CALL_ENDED."""
        ctx = {"customer_name": "Acme Corp", "outstanding": "₹50,000"}
        res = self.agent.process_structured_turn("I refuse to pay and cease all contact", "CONFIRM_BALANCE", ctx)

        self.assertEqual(res["next_stage"], "CALL_ENDED")
        self.assertTrue(res["should_end"])
        self.assertEqual(res["outcome"], "NO_CONTACT")
        self.assertNotIn("balance", res["reply"].lower())

    # ── New Tests: Refusals, Inability to Pay, Claims, Questions, Human Requests ──

    def test_refusal_without_dnd(self):
        """Pure refusal to pay is logged as REFUSED_TO_PAY without DND flag."""
        res = self.agent.process_reply("I refuse to pay this invoice", self.context)
        self.assertEqual(res["outcome"], "REFUSED_TO_PAY")
        self.assertTrue(res["should_end"])
        self.assertIn("refusal", res["reply"].lower())

    def test_inability_to_pay_hardship(self):
        """Inability to pay triggers hardship protocol with installment negotiation."""
        res = self.agent.process_reply("We are facing a severe cash crunch and have no funds right now", self.context)
        self.assertEqual(res["outcome"], "UNABLE_TO_PAY")
        self.assertFalse(res["should_end"])
        self.assertIn("installment", res["reply"].lower())
        self.assertTrue(self.context.get("awaiting_confirmation"))
        self.assertEqual(self.context.get("pending_action"), "HARDSHIP_PLAN")

    def test_payment_claim_with_details(self):
        """Customer claims payment already made with UTR reference."""
        res = self.agent.process_reply("I already paid ₹50,000 yesterday via NEFT UTR: 987654321", self.context)
        self.assertEqual(res["outcome"], "PAYMENT_CLAIMED")
        self.assertTrue(res["should_end"])
        self.assertIn("logged your payment claim", res["reply"].lower())
        self.assertEqual(self.context["extracted"].get("claimed_utr"), "987654321")

    def test_invoice_details_question(self):
        """Customer asking for invoice details receives dynamic response and stays in progress."""
        res = self.agent.process_reply("What is this for and what are the invoice details?", self.context)
        self.assertEqual(res["outcome"], "IN_PROGRESS")
        self.assertFalse(res["should_end"])
        self.assertIn("₹50,000", res["reply"])

    def test_payment_method_question(self):
        """Customer asking how to pay gets payment options."""
        res = self.agent.process_reply("How can I make the payment, do you have a UPI id?", self.context)
        self.assertEqual(res["outcome"], "IN_PROGRESS")
        self.assertFalse(res["should_end"])
        self.assertIn("upi", res["reply"].lower())

    def test_human_agent_escalation(self):
        """Customer requesting a human manager is transferred immediately."""
        res = self.agent.process_reply("I want to speak with a human manager please", self.context)
        self.assertEqual(res["outcome"], "TRANSFERRED_TO_AGENT")
        self.assertTrue(res["should_end"])
        self.assertIn("transferring your call", res["reply"].lower())

    def test_strict_promise_confirmation_requires_explicit_agreement(self):
        """Vague mention of timeframe does NOT lock in promise until explicitly confirmed."""
        # 1. Customer tentatively mentions a day without commitment word
        res1 = self.agent.process_reply("Maybe next week or Friday", self.context)
        self.assertEqual(res1["outcome"], "IN_PROGRESS")
        self.assertFalse(res1["should_end"])
        self.assertTrue(self.context.get("awaiting_confirmation"))

        # 2. If customer says no, promise is cancelled and conversation continues
        res2 = self.agent.process_reply("No, let me check with our CFO first", self.context)
        self.assertEqual(res2["outcome"], "IN_PROGRESS")
        self.assertFalse(res2["should_end"])
        self.assertFalse(self.context.get("awaiting_confirmation"))

    def test_multi_turn_context_memory_retention(self):
        """Context history accumulates customer and agent turns with turn count."""
        ctx = {"customer_name": "Sharma Textiles", "outstanding": "₹1,20,000"}
        self.agent.process_reply("What is the pending amount?", ctx)
        self.agent.process_reply("Can I get a copy on WhatsApp?", ctx)
        self.agent.process_reply("I am in a meeting right now, please call later", ctx)

        self.assertEqual(ctx["turn_count"], 3)
        self.assertEqual(len(ctx["history"]), 6)  # 3 customer + 3 agent messages
        self.assertEqual(ctx["history"][0]["role"], "customer")
        self.assertEqual(ctx["history"][1]["role"], "agent")

    # ── Priority 1 Required Automated Multi-Turn Conversation Tests ───────────

    def test_cant_pay_anything_followed_by_20_days_from_now_multi_turn(self):
        """
        Recreates and verifies the screenshot fix:
        Turn 1: 'I can't pay anything.' -> Empathetic hardship acknowledgment, NO demand for date.
        Turn 2: '20 days from now.' -> Recognized as tentative easing timeframe, NOT agreed payment date.
        Turn 3: 'financial issue.' -> Logged as hardship reason, NOT contradictory promise date.
        Turn 4: 'UPI.' -> Preferred method only, NO unsolicited link or false PROMISE_TO_PAY!
        """
        ctx = {"customer_name": "Mehta Traders Ltd", "outstanding": "₹89,500"}

        # Turn 1: Customer states absolute inability to pay anything
        t1 = self.agent.process_reply("I can't pay anything.", ctx)
        self.assertEqual(t1["outcome"], "UNABLE_TO_PAY")
        self.assertFalse(t1["should_end"])
        self.assertEqual(ctx["extracted"]["can_pay"], "NO")
        # Must not pressure for immediate payment or promise
        self.assertNotIn("locked in your payment commitment", t1["reply"].lower())
        self.assertNotIn("what partial amount would you be able to clear today", t1["reply"].lower())

        # Turn 2: Customer gives future timeframe when situation might improve
        t2 = self.agent.process_reply("20 days from now.", ctx)
        self.assertEqual(t2["outcome"], "IN_PROGRESS")
        self.assertFalse(t2["should_end"])
        self.assertEqual(ctx["extracted"]["tentative_timeframe"], "20 days from now")
        # Must NOT set agreed_amount as '20 days from now'
        self.assertNotEqual(ctx["extracted"].get("agreed_amount"), "20 days from now")

        # Turn 3: Customer explains hardship reason
        t3 = self.agent.process_reply("financial issue.", ctx)
        self.assertEqual(t3["outcome"], "IN_PROGRESS")
        self.assertFalse(t3["should_end"])
        self.assertEqual(ctx["extracted"]["hardship_reason"], "financial issue.")
        # Must NOT treat 'financial issue' as payment date
        self.assertNotEqual(ctx["extracted"].get("promised_date"), "financial issue.")

        # Turn 4: Customer mentions preferred payment mode
        t4 = self.agent.process_reply("UPI.", ctx)
        self.assertEqual(t4["outcome"], "IN_PROGRESS")
        self.assertFalse(t4["should_end"])
        self.assertEqual(ctx["extracted"]["payment_method_preference"], "UPI")
        # Must NOT claim PROMISE_TO_PAY or send link without permission
        self.assertFalse(ctx["extracted"].get("link_authorization_granted"))
        self.assertNotEqual(ctx["extracted"].get("commitment_status"), "CONFIRMED")
        self.assertNotEqual(t4["outcome"], "PROMISE_TO_PAY")

    def test_cant_pay_anything_followed_by_financial_issue(self):
        """Customer expressing inability to pay followed by financial issue has hardship documented."""
        ctx = {"customer_name": "Verma Industries", "outstanding": "₹45,000"}
        t1 = self.agent.process_reply("I cannot pay anything right now", ctx)
        self.assertEqual(t1["outcome"], "UNABLE_TO_PAY")

        t2 = self.agent.process_reply("We are having severe financial issues", ctx)
        self.assertEqual(ctx["extracted"]["can_pay"], "NO")
        self.assertIn("financial hardship", t2["reply"].lower())

    def test_future_payment_intention_will_pay_later(self):
        """Customer stating 'I will pay later' is classified as WILL_PAY_LATER, not PROMISE_TO_PAY."""
        ctx = {"customer_name": "Nova Corp", "outstanding": "₹60,000"}
        res = self.agent.process_reply("I will pay later", ctx)
        self.assertEqual(res["outcome"], "WILL_PAY_LATER")
        self.assertFalse(res["should_end"])
        self.assertTrue(ctx["extracted"].get("will_pay_later"))
        self.assertNotEqual(ctx["extracted"].get("commitment_status"), "CONFIRMED")

    def test_upi_without_authorization_to_send_payment_link(self):
        """Customer stating 'UPI' records preference but does NOT authorize dispatching links."""
        ctx = {"customer_name": "Kapur Ltd", "outstanding": "₹30,000"}
        t = self.agent.process_reply("UPI", ctx)
        self.assertEqual(ctx["extracted"]["payment_method_preference"], "UPI")
        self.assertFalse(ctx["extracted"]["link_authorization_granted"])
        self.assertTrue(ctx["extracted"]["link_authorization_requested"])
        self.assertIn("would you like us to dispatch a payment link", t["reply"].lower())

    def test_no_in_response_to_proposed_payment_commitment(self):
        """When a customer says 'No' to a proposed commitment, proposal is cancelled and not locked."""
        ctx = {
            "customer_name": "Patel Enterprises",
            "outstanding": "₹60,000",
            "awaiting_confirmation": True,
            "pending_action": "PROMISE_TO_PAY",
            "extracted": {
                "agreed_amount": "₹60,000",
                "promised_date": "Next Monday",
                "commitment_status": "PROPOSED",
            },
        }
        res = self.agent.process_reply("No, I cannot commit to that", ctx)
        self.assertEqual(res["outcome"], "IN_PROGRESS")
        self.assertFalse(res["should_end"])
        self.assertEqual(ctx["extracted"]["commitment_status"], "REJECTED")
        self.assertIsNone(ctx["extracted"]["agreed_amount"])
        self.assertIsNone(ctx["extracted"]["promised_date"])
        self.assertFalse(ctx["awaiting_confirmation"])
        self.assertIn("cancelled that proposal", res["reply"].lower())

    def test_maybe_next_week_and_i_will_try(self):
        """Tentative phrases ('maybe next week', 'I will try') must NOT be treated as confirmed promises."""
        ctx1 = {"customer_name": "Apex Corp", "outstanding": "₹40,000"}
        res1 = self.agent.process_reply("Maybe next week", ctx1)
        self.assertEqual(res1["outcome"], "IN_PROGRESS")
        self.assertFalse(res1["should_end"])
        self.assertNotEqual(ctx1["extracted"].get("commitment_status"), "CONFIRMED")

        ctx2 = {"customer_name": "Apex Corp", "outstanding": "₹40,000"}
        res2 = self.agent.process_reply("I will try my best", ctx2)
        self.assertEqual(res2["outcome"], "IN_PROGRESS")
        self.assertFalse(res2["should_end"])
        self.assertNotEqual(ctx2["extracted"].get("commitment_status"), "CONFIRMED")

    def test_explicit_agreement_to_valid_date_and_amount(self):
        """Explicit agreement with valid date and amount records a verified PROMISE_TO_PAY."""
        ctx = {"customer_name": "Sunrise Ltd", "outstanding": "₹75,000"}
        res = self.agent.process_reply("We will pay ₹75,000 this Friday by UPI", ctx)
        self.assertEqual(res["outcome"], "PROMISE_TO_PAY")
        self.assertTrue(res["should_end"])
        self.assertEqual(ctx["extracted"]["agreed_amount"], "₹75,000")
        self.assertEqual(ctx["extracted"]["promised_date"], "Friday")
        self.assertEqual(ctx["extracted"]["payment_method"], "UPI")
        self.assertEqual(ctx["extracted"]["commitment_status"], "CONFIRMED")
        self.assertTrue(res.get("action_executed"))

    def test_customer_agrees_then_withdraws_agreement(self):
        """When a customer previously agreed to pay but then withdraws it, promise is cancelled."""
        ctx = {
            "customer_name": "Sunrise Ltd",
            "outstanding": "₹75,000",
            "extracted": {
                "agreed_amount": "₹75,000",
                "promised_date": "Friday",
                "commitment_status": "CONFIRMED",
            },
        }
        res = self.agent.process_reply("Wait, cancel that, I cannot pay Friday after all", ctx)
        self.assertEqual(res["outcome"], "IN_PROGRESS")
        self.assertFalse(res["should_end"])
        self.assertEqual(ctx["extracted"]["commitment_status"], "CANCELLED")
        self.assertIsNone(ctx["extracted"]["agreed_amount"])
        self.assertIsNone(ctx["extracted"]["promised_date"])
        self.assertIn("withdrawal of that payment date", res["reply"].lower())

    def test_payment_already_made_with_utr(self):
        """Customer claiming payment made with UTR is logged with reference for reconciliation."""
        ctx = {"customer_name": "Global Traders", "outstanding": "₹1,10,000"}
        res = self.agent.process_reply("Payment was already made yesterday with UTR: HDFC12345678", ctx)
        self.assertEqual(res["outcome"], "PAYMENT_CLAIMED")
        self.assertTrue(res["should_end"])
        self.assertEqual(ctx["extracted"]["claimed_utr"], "HDFC12345678")
        self.assertIn("HDFC12345678", res["reply"])

    def test_customer_disputes_invoice(self):
        """Customer disputing the invoice is flagged for high-priority billing review."""
        ctx = {"customer_name": "Delta Systems", "outstanding": "₹22,000", "invoice_number": "INV-2026-99"}
        res = self.agent.process_reply("We dispute this invoice, we never received these goods", ctx)
        self.assertEqual(res["outcome"], "DISPUTE")
        self.assertTrue(res["should_end"])
        self.assertEqual(ctx["extracted"]["is_dispute"], True)
        self.assertIn("high priority", res["reply"].lower())

    def test_customer_requests_human_or_callback(self):
        """Customer requests for human or callback are handled with appropriate outcomes."""
        ctx1 = {"customer_name": "Zenith Corp", "outstanding": "₹50,000"}
        r1 = self.agent.process_reply("Please transfer me to a human manager", ctx1)
        self.assertEqual(r1["outcome"], "TRANSFERRED_TO_AGENT")
        self.assertTrue(r1["should_end"])

        ctx2 = {"customer_name": "Zenith Corp", "outstanding": "₹50,000"}
        r2 = self.agent.process_reply("I am driving right now, call me back later", ctx2)
        self.assertEqual(r2["outcome"], "CALLBACK_REQUESTED")
        self.assertTrue(r2["should_end"])

    def test_customer_says_stop_calling(self):
        """Customer demanding stop calling immediately receives NO_CONTACT and ends conversation."""
        ctx = {"customer_name": "Target Corp", "outstanding": "₹15,000"}
        res = self.agent.process_reply("STOP CALLING ME", ctx)
        self.assertEqual(res["outcome"], "NO_CONTACT")
        self.assertTrue(res["should_end"])
        self.assertTrue(ctx["extracted"]["is_no_contact"])
        self.assertIn("stop calls", res["reply"].lower())

    def test_unrelated_or_unclear_answers(self):
        """Unrelated speech does not trigger unintended commitments or terminations."""
        ctx = {"customer_name": "Target Corp", "outstanding": "₹15,000"}
        res = self.agent.process_reply("The weather is quite cloudy today", ctx)
        self.assertEqual(res["outcome"], "IN_PROGRESS")
        self.assertFalse(res["should_end"])
        self.assertNotEqual(ctx["extracted"].get("commitment_status"), "CONFIRMED")

    def test_final_outcome_contradicts_earlier_tentative_statement(self):
        """When an earlier tentative statement is followed by hardship, outcome is hardship NOT PTP."""
        ctx = {"customer_name": "Target Corp", "outstanding": "₹15,000"}
        # Turn 1: Tentative mention
        self.agent.process_reply("Maybe next Tuesday", ctx)
        self.assertEqual(ctx.get("awaiting_confirmation"), True)

        # Turn 2: Clear contradiction / rejection
        res2 = self.agent.process_reply("Actually no, we have severe cash crunch and no funds", ctx)
        self.assertEqual(res2["outcome"], "UNABLE_TO_PAY")
        self.assertFalse(ctx.get("awaiting_confirmation"))
        self.assertNotEqual(res2["outcome"], "PROMISE_TO_PAY")

    def test_multiple_invoices_not_mixed(self):
        """Customer with multiple invoices receives an itemized response without mixing details."""
        ctx = {
            "customer_name": "Multi Inv Client",
            "outstanding": "₹1,50,000",
            "invoice_number": "INV-101",
            "invoices": [
                {"number": "INV-101", "outstanding": "₹1,00,000", "dueDate": "2026-10-01"},
                {"number": "INV-102", "outstanding": "₹50,000", "dueDate": "2026-10-15"},
            ],
        }
        res = self.agent.process_reply("Which multiple invoices are overdue?", ctx)
        self.assertEqual(res["outcome"], "IN_PROGRESS")
        self.assertIn("2 active invoices", res["reply"])
        self.assertIn("#INV-101 for ₹1,00,000", res["reply"])
        self.assertIn("#INV-102 for ₹50,000", res["reply"])

    def test_livekit_worker_pre_call_consent_enforcement(self):
        """Worker strictly suppresses call if customer has NO_CONTACT preference or DND note."""
        from agent import LiveKitChotuWorker
        worker = LiveKitChotuWorker(agent=self.agent)

        # 1. Active DND note suppresses call
        self.assertFalse(worker.check_pre_call_consent(customer_notes="[DND:NO_CONTACT - Requested on 2026-10-15]"))
        self.assertFalse(worker.check_pre_call_consent(customer_notes="Customer said NO_CONTACT please"))
        self.assertFalse(worker.check_pre_call_consent(customer_notes="OPT_OUT confirmed"))

        # 2. Preferred channel NO_CONTACT suppresses call
        self.assertFalse(worker.check_pre_call_consent(preferred_channel="NO_CONTACT"))

        # 3. Normal customer passes consent check
        self.assertTrue(worker.check_pre_call_consent(customer_notes="Call after 2 PM", preferred_channel="CALL"))

    def test_livekit_worker_token_generation(self):
        """Worker generates valid room token with minimum permissions and expiry."""
        from agent import LiveKitChotuWorker
        worker = LiveKitChotuWorker(agent=self.agent)

        token = worker.generate_agent_token("mcf-test-room-101", ttl_seconds=600)
        self.assertTrue(len(token) > 10)
        self.assertIsInstance(token, str)

    def test_livekit_worker_process_transcript_turn(self):
        """Worker routes LiveKit incoming transcript through 10-stage conversation engine."""
        from agent import LiveKitChotuWorker
        worker = LiveKitChotuWorker(agent=self.agent)
        ctx = {"customer_name": "Sharma Textiles", "outstanding": "₹75,000", "extracted": {}}

        # Hardship scenario via LiveKit track transcript
        res = worker.process_incoming_transcript("We cannot pay because our cash flow is completely blocked", "ASK_FULL_PAYMENT", ctx)
        self.assertEqual(res["next_stage"], "NEGOTIATE_AMOUNT")
        self.assertFalse(res["should_end"])


if __name__ == "__main__":
    unittest.main()




