import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/models/models.dart';

void main() {
  test('User model serialization test', () {
    final user = User(
      id: 'u1',
      email: 'test@mycashflo.in',
      name: 'Test Agent',
      role: 'AGENT',
      tenantId: 't1',
    );

    final json = user.toJson();
    expect(json['email'], 'test@mycashflo.in');
    expect(json['role'], 'AGENT');

    final parsed = User.fromJson(json);
    expect(parsed.id, 'u1');
    expect(parsed.name, 'Test Agent');
  });

  test('Customer model parsing test', () {
    final json = {
      'id': 'c1',
      'name': 'Raj Enterprises',
      'email': 'raj@ent.in',
      'phone': '+91 9999999999',
      'outstandingBalance': 150000,
      'status': 'ACTIVE',
    };

    final customer = Customer.fromJson(json);
    expect(customer.name, 'Raj Enterprises');
    expect(customer.outstandingBalance, 150000.0);
  });

  test('ActionProposal model parsing test', () {
    final json = {
      'id': 'prop_1',
      'toolName': 'record_payment_promise',
      'summary': 'Record PTP for Raj Enterprises',
      'riskLevel': 'HIGH',
      'status': 'PENDING',
      'createdAt': '2026-10-15T00:00:00.000Z',
      'parameters': {'amount': 50000},
    };

    final prop = ActionProposal.fromJson(json);
    expect(prop.id, 'prop_1');
    expect(prop.toolName, 'record_payment_promise');
    expect(prop.riskLevel, 'HIGH');
    expect(prop.status, 'PENDING');
  });

  test('NotificationItem and AuditLogItem model parsing test', () {
    final notifJson = {
      'id': 'notif_1',
      'customerId': 'c1',
      'channel': 'WHATSAPP',
      'template': 'PAYMENT_REMINDER_OVERDUE',
      'status': 'DELIVERED',
      'createdAt': '2026-10-15T00:00:00.000Z',
      'customer': {'name': 'Raj Enterprises'},
    };

    final notif = NotificationItem.fromJson(notifJson);
    expect(notif.customerName, 'Raj Enterprises');
    expect(notif.channel, 'WHATSAPP');
    expect(notif.status, 'DELIVERED');

    final auditJson = {
      'id': 'audit_1',
      'action': 'ai.action_approved_and_executed',
      'createdAt': '2026-10-15T00:00:00.000Z',
      'user': {'name': 'Priya Sharma'},
    };

    final audit = AuditLogItem.fromJson(auditJson);
    expect(audit.action, 'ai.action_approved_and_executed');
    expect(audit.userName, 'Priya Sharma');
  });

  test('PaymentLinkItem and TelephonyCallSession model parsing test', () {
    final payLinkJson = {
      'paymentLinkId': 'plink_12345',
      'provider': 'RAZORPAY',
      'shortUrl': 'https://rzp.io/i/mock_12345',
      'amount': 25000,
      'currency': 'INR',
      'status': 'CREATED',
      'isSimulated': true,
    };

    final payLink = PaymentLinkItem.fromJson(payLinkJson);
    expect(payLink.paymentLinkId, 'plink_12345');
    expect(payLink.provider, 'RAZORPAY');
    expect(payLink.amount, 25000.0);
    expect(payLink.isSimulated, true);

    final callJson = {
      'callSid': 'CA_sim_998877',
      'provider': 'SIP_GATEWAY',
      'status': 'SIMULATED',
      'isSimulated': true,
      'notes': 'Outbound telephony is disabled by policy. Safe simulation active.',
    };

    final callSession = TelephonyCallSession.fromJson(callJson);
    expect(callSession.callSid, 'CA_sim_998877');
    expect(callSession.status, 'SIMULATED');
    expect(callSession.isSimulated, true);
    expect(callSession.notes, contains('disabled by policy'));
  });
}


