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
}
