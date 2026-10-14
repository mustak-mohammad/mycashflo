import unittest
from agent import ChotuAgent

class TestChotuAgent(unittest.TestCase):
    def setUp(self):
        self.agent = ChotuAgent()
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

if __name__ == "__main__":
    unittest.main()
