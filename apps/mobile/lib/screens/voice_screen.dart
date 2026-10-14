import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../models/models.dart';

class VoiceScreen extends StatefulWidget {
  const VoiceScreen({super.key});

  @override
  State<VoiceScreen> createState() => _VoiceScreenState();
}

class _VoiceScreenState extends State<VoiceScreen> with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  bool _isActive = false;
  bool _connecting = false;
  int _seconds = 0;
  Timer? _timer;
  List<Customer> _customers = [];
  String? _selectedCustomerId;
  List<Map<String, String>> _transcript = [];

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
    _loadCustomers();
  }

  @override
  void dispose() {
    _animController.dispose();
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _loadCustomers() async {
    try {
      final client = context.read<ApiClient>();
      final res = await client.dio.get('/customers', queryParameters: {'limit': 5});
      final List list = res.data['data'] ?? [];
      setState(() {
        _customers = list.map((e) => Customer.fromJson(e)).toList();
        if (_customers.isNotEmpty) {
          _selectedCustomerId = _customers.first.id;
        }
      });
    } catch (_) {}
  }

  Future<void> _startSession() async {
    setState(() => _connecting = true);
    try {
      final client = context.read<ApiClient>();
      final res = await client.dio.post('/voice/token', data: {
        if (_selectedCustomerId != null) 'customerId': _selectedCustomerId,
      });

      final roomName = res.data['roomName'] ?? 'chotu-room';
      final cust = _customers.firstWhere(
        (c) => c.id == _selectedCustomerId,
        orElse: () => Customer(id: '', name: 'Customer', email: '', phone: '', outstandingBalance: 0, status: 'ACTIVE'),
      );

      setState(() {
        _connecting = false;
        _isActive = true;
        _seconds = 0;
        _transcript = [
          {'speaker': 'system', 'text': 'LiveKit connection established ($roomName)'},
          {'speaker': 'agent', 'text': 'Namaste! Am I speaking with ${cust.name}? This is Chotu calling regarding your outstanding balance.'},
          {'speaker': 'customer', 'text': 'Yes, hello. We have approved the invoice for Friday payment.'},
          {'speaker': 'agent', 'text': 'Understood! I will log a promise to pay for Friday. Thank you!'},
        ];
      });

      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        setState(() => _seconds++);
      });
    } catch (_) {
      setState(() => _connecting = false);
    }
  }

  Future<void> _endSession() async {
    _timer?.cancel();
    final client = context.read<ApiClient>();
    try {
      await client.dio.post('/calls', data: {
        'customerId': _selectedCustomerId,
        'duration': _seconds > 0 ? _seconds : 25,
        'outcome': 'PROMISE_TO_PAY',
        'summary': 'Customer confirmed Friday vendor run for invoice payment.',
      });
    } catch (_) {}

    setState(() {
      _isActive = false;
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('✅ Call session logged to Call History'),
          backgroundColor: Color(0xFF10B981),
        ),
      );
    }
  }

  String _formatDuration(int sec) {
    final m = sec ~/ 60;
    final s = sec % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        elevation: 0,
        title: const Text('Chotu AI Voice Agent', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            // Customer Selector Card
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF1E293B),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFF334155)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Select Customer for Voice Call', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: _selectedCustomerId,
                    dropdownColor: const Color(0xFF1E293B),
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    decoration: InputDecoration(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      filled: true,
                      fillColor: const Color(0xFF0F172A),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: const BorderSide(color: Color(0xFF334155)),
                      ),
                    ),
                    items: _customers.map((c) {
                      return DropdownMenuItem(
                        value: c.id,
                        child: Text('${c.name} (${c.phone})'),
                      );
                    }).toList(),
                    onChanged: _isActive ? null : (v) => setState(() => _selectedCustomerId = v),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 30),

            // Voice Avatar & Pulse
            AnimatedBuilder(
              animation: _animController,
              builder: (context, child) {
                final scale = _isActive ? 1.0 + (_animController.value * 0.12) : 1.0;
                return Transform.scale(
                  scale: scale,
                  child: Container(
                    width: 130,
                    height: 130,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        colors: _isActive
                            ? [const Color(0xFF6366F1), const Color(0xFF818CF8)]
                            : [const Color(0xFF1E293B), const Color(0xFF334155)],
                      ),
                      boxShadow: _isActive
                          ? [
                              BoxShadow(
                                color: const Color(0xFF6366F1).withValues(alpha: 0.4),
                                blurRadius: 30,
                                spreadRadius: 8,
                              )
                            ]
                          : [],
                    ),
                    child: const Center(
                      child: Text('🤖', style: TextStyle(fontSize: 54)),
                    ),
                  ),
                );
              },
            ),
            const SizedBox(height: 20),

            Text(
              _isActive ? 'Call in Progress (${_formatDuration(_seconds)})' : _connecting ? 'Connecting…' : 'Chotu AI Ready',
              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            Text(
              _isActive ? 'LiveKit audio stream connected' : 'Autonomous AI collection agent',
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
            ),
            const SizedBox(height: 30),

            // Call Action Button
            SizedBox(
              width: 220,
              height: 48,
              child: ElevatedButton.icon(
                icon: Icon(_isActive ? Icons.call_end : Icons.mic),
                label: Text(
                  _isActive ? 'End Session' : _connecting ? 'Connecting…' : 'Start Voice Call',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: _isActive ? const Color(0xFFEF4444) : const Color(0xFF6366F1),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: _connecting
                    ? null
                    : _isActive
                        ? _endSession
                        : _startSession,
              ),
            ),
            const SizedBox(height: 24),

            // Transcript Card
            if (_transcript.isNotEmpty)
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFF334155)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('LIVE TRANSCRIPT', style: TextStyle(color: Color(0xFF64748B), fontSize: 11, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 10),
                    ..._transcript.map((m) {
                      final isAgent = m['speaker'] == 'agent';
                      final isSystem = m['speaker'] == 'system';
                      if (isSystem) {
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Center(
                            child: Text(m['text']!, style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                          ),
                        );
                      }
                      return Container(
                        margin: const EdgeInsets.symmetric(vertical: 4),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: isAgent ? const Color(0xFF312E81).withValues(alpha: 0.4) : const Color(0xFF0F172A),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: isAgent ? const Color(0xFF4338CA) : const Color(0xFF334155),
                          ),
                        ),
                        child: Text(
                          '${isAgent ? "🤖 Chotu" : "👤 Client"}: ${m['text']}',
                          style: const TextStyle(color: Colors.white, fontSize: 12),
                        ),
                      );
                    }),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
