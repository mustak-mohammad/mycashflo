"""
Live Verification Script for:
1. Server-Side Logout (@Post('logout') in services/api/src/auth/auth.controller.ts)
2. Cease-Contact Handling in Voice Agent (ported into services/voice-agent/agent.py)
"""

import sys
import json
import urllib.request
import urllib.error
from agent import ChotuAgent, is_cease_contact_request

BASE_URL = "http://localhost:3000/api"

def http_post(url: str, data: dict, token: str = None) -> tuple:
    payload = json.dumps(data).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"raw": body}

def main():
    print("=" * 70)
    print("LIVE VERIFICATION: Server-Side Logout & Voice Agent Cease-Contact")
    print("=" * 70)

    # ──────────────────────────────────────────────────────────────────────────
    # PART 1: Server-Side Logout Verification
    # ──────────────────────────────────────────────────────────────────────────
    print("\n--- TEST 1: Server-Side Logout (@Post('logout')) ---")
    
    # 1.1 Login as demo admin
    status, login_res = http_post(f"{BASE_URL}/auth/login", {
        "email": "admin@democorp.in",
        "password": "Admin@1234"
    })
    assert status == 200, f"Login failed: {login_res}"
    user = login_res["user"]
    tokens = login_res["tokens"]
    access_token = tokens["accessToken"]
    refresh_token = tokens["refreshToken"]
    print(f"[OK] 1.1 Logged in as: {user['email']} (User ID: {user['id']})")
    print(f"    Access Token:  {access_token[:25]}...")
    print(f"    Refresh Token: {refresh_token[:25]}...")

    # 1.2 Verify refresh works before logout
    status, refresh_before = http_post(f"{BASE_URL}/auth/refresh", {
        "refreshToken": refresh_token
    })
    assert status == 200, f"Pre-logout refresh failed: {refresh_before}"
    rotated_refresh_token = refresh_before["tokens"]["refreshToken"]
    rotated_access_token = refresh_before["tokens"]["accessToken"]
    print(f"[OK] 1.2 Token refresh works properly before logout")

    # 1.3 Call @Post('logout')
    status, logout_res = http_post(
        f"{BASE_URL}/auth/logout",
        {"refreshToken": rotated_refresh_token},
        token=rotated_access_token
    )
    assert status == 200, f"Logout failed: {logout_res}"
    print(f"[OK] 1.3 POST /api/auth/logout returned 200 OK: {logout_res}")

    # 1.4 Verify the refresh token is now revoked in database and rejected
    status, refresh_after = http_post(f"{BASE_URL}/auth/refresh", {
        "refreshToken": rotated_refresh_token
    })
    assert status == 401, f"Expected 401, got {status}: {refresh_after}"
    print(f"[OK] 1.4 POST /api/auth/refresh with revoked token returned 401 Unauthorized:")
    print(f"    Message: {refresh_after.get('message')}")

    # ──────────────────────────────────────────────────────────────────────────
    # PART 2: Voice Agent Cease-Contact Handling
    # ──────────────────────────────────────────────────────────────────────────
    print("\n--- TEST 2: Voice Agent Cease-Contact Handling (agent.py) ---")

    # 2.1 Verify phrase matcher on natural language inputs
    test_utterances = [
        ("Stop calling me immediately.", True),
        ("Please remove this number from your database", True),
        ("I refuse to pay, do not contact me", True),
        ("take me off your list right now", True),
        ("I am in a meeting, call back later", False),
        ("I will pay next Friday", False),
    ]
    for utterance, expected in test_utterances:
        matched = is_cease_contact_request(utterance)
        assert matched == expected, f"Mismatch for '{utterance}': got {matched}, expected {expected}"
        print(f"    Matched: '{utterance}' -> {matched} (Expected: {expected})")
    print("[OK] 2.1 is_cease_contact_request phrase classification verified.")

    # 2.2 Test ChotuAgent live against running application with authenticated token
    # Login again to get a fresh token for agent
    status, agent_login = http_post(f"{BASE_URL}/auth/login", {
        "email": "agent@democorp.in",
        "password": "Agent@1234"
    })
    assert status == 200, f"Agent login failed: {agent_login}"
    agent_token = agent_login["tokens"]["accessToken"]

    agent = ChotuAgent(api_base_url=BASE_URL, token=agent_token)

    # Fetch customer ID from DB via tools
    # Let's test with customer 'cmv6st54i0006cxtoj0zr70oz' (Raj Enterprises)
    customer_id = "cmv6st54i0006cxtoj0zr70oz"
    context = {
        "customer_id": customer_id,
        "customer_name": "Raj Enterprises",
        "outstanding": "Rs. 1,45,000",
    }

    # Process cease contact utterance
    turn_res = agent.process_reply("Stop calling me. Please remove my number from your list.", context)
    print("\n[OK] 2.2 ChotuAgent process_reply response:")
    print(f"    Reply:                \"{turn_res['reply']}\"")
    print(f"    Outcome:              {turn_res['outcome']}")
    print(f"    Next Stage:           {turn_res.get('next_stage')}")
    print(f"    Should End:           {turn_res['should_end']}")
    print(f"    Action Executed:      {turn_res.get('action_executed')}")
    print(f"    Preference Persisted: {turn_res.get('preference_persisted')}")

    assert turn_res["outcome"] == "NO_CONTACT", f"Expected NO_CONTACT, got {turn_res['outcome']}"
    assert turn_res["should_end"] is True, "Expected should_end to be True"
    assert turn_res["next_stage"] == "CALL_ENDED", "Expected next_stage to be CALL_ENDED"
    assert turn_res["preference_persisted"] is True, "Expected preference to be persisted"

    # 2.3 Also test structured turn flow
    structured_res = agent.process_structured_turn(
        "Cease all contact immediately",
        stage="CONFIRM_BALANCE",
        context=context
    )
    print("\n[OK] 2.3 ChotuAgent process_structured_turn response:")
    print(f"    Reply:           \"{structured_res['reply']}\"")
    print(f"    Next Stage:      {structured_res['next_stage']}")
    print(f"    Outcome:         {structured_res['outcome']}")
    print(f"    Should End:      {structured_res['should_end']}")

    assert structured_res["outcome"] == "NO_CONTACT"
    assert structured_res["next_stage"] == "CALL_ENDED"
    assert structured_res["should_end"] is True

    print("\n" + "=" * 70)
    print("SUCCESS: ALL LIVE CHECKS PASSED SUCCESSFULLY!")
    print("=" * 70)

if __name__ == "__main__":
    main()
