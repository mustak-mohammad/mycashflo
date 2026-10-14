import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dio/dio.dart';
import '../api/api_client.dart';
import '../models/models.dart';

class AuthProvider extends ChangeNotifier {
  final ApiClient apiClient;
  User? _user;
  String? _token;
  bool _isLoading = false;
  String? _error;

  AuthProvider({required this.apiClient}) {
    _loadStoredSession();
  }

  User? get user => _user;
  String? get token => _token;
  bool get isAuthenticated => _token != null;
  bool get isLoading => _isLoading;
  String? get error => _error;

  Future<void> _loadStoredSession() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('access_token');
    final userJson = prefs.getString('user_profile');
    if (userJson != null) {
      try {
        _user = User.fromJson(jsonDecode(userJson));
      } catch (_) {}
    }
    notifyListeners();
  }

  Future<bool> login(String email, String password) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await apiClient.dio.post(
        '/auth/login',
        data: {'email': email, 'password': password},
      );

      final data = response.data;
      _token = data['tokens']['accessToken'];
      _user = User.fromJson(data['user']);

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('access_token', _token!);
      await prefs.setString('user_profile', jsonEncode(_user!.toJson()));

      _isLoading = false;
      notifyListeners();
      return true;
    } on DioException catch (e) {
      _isLoading = false;
      _error = e.response?.data?['message'] ?? 'Login failed. Please check credentials.';
      notifyListeners();
      return false;
    } catch (e) {
      _isLoading = false;
      _error = 'Connection error. Ensure backend API is running.';
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('access_token');
    await prefs.remove('user_profile');
    _user = null;
    _token = null;
    notifyListeners();
  }
}
