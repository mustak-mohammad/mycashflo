import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Central API Client for myCashflo Mobile Application.
///
/// Configurable API Base URL via Flutter build-time `--dart-define=API_BASE_URL=...`.
///
/// Configuration Guide:
/// 1. Android Emulator:
///    `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api`
///    (Android emulators route the host loopback interface to 10.0.2.2).
///
/// 2. iOS Simulator / Desktop / Web:
///    `flutter run --dart-define=API_BASE_URL=http://localhost:3000/api`
///
/// 3. Physical Android / iOS Device:
///    `flutter run --dart-define=API_BASE_URL=http://<YOUR_LAN_IP>:3000/api`
///    (e.g. `http://192.168.1.100:3000/api`, ensuring phone & PC are on the same Wi-Fi
///    and PC firewall allows port 3000 inbound).
///
/// 4. Production:
///    `flutter build apk --dart-define=API_BASE_URL=https://api.mycashflo.in/api`
///    (Always use production HTTPS API URL; never use plaintext HTTP in production).
class ApiClient {
  static const String _defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api',
  );

  late final Dio dio;

  ApiClient({String baseUrl = _defaultBaseUrl}) {
    dio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        headers: {'Content-Type': 'application/json'},
      ),
    );

    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final prefs = await SharedPreferences.getInstance();
          final token = prefs.getString('access_token');
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          return handler.next(options);
        },
      ),
    );
  }

  /// Helper to get current active base URL
  static String get defaultBaseUrl => _defaultBaseUrl;
}
