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


if __name__ == "__main__":
    unittest.main()

