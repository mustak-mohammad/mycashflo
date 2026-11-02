import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/api/api_client.dart';

void main() {
  group('ApiClient Configuration Tests', () {
    test('defaultBaseUrl matches configured fallback when no dart-define is provided', () {
      expect(ApiClient.defaultBaseUrl, equals('http://localhost:3000/api'));
    });

    test('ApiClient initializes with custom baseUrl when supplied', () {
      final client = ApiClient(baseUrl: 'http://10.0.2.2:3000/api');
      expect(client.dio.options.baseUrl, equals('http://10.0.2.2:3000/api'));
      expect(client.dio.options.connectTimeout, equals(const Duration(seconds: 15)));
      expect(client.dio.options.headers['Content-Type'], equals('application/json'));
    });

    test('ApiClient defaults to defaultBaseUrl when baseUrl is omitted', () {
      final client = ApiClient();
      expect(client.dio.options.baseUrl, equals(ApiClient.defaultBaseUrl));
    });
  });
}
