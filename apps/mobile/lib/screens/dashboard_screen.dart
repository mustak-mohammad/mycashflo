import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../models/models.dart';
import '../providers/auth_provider.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  DashboardStats? _stats;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchStats();
  }

  Future<void> _fetchStats() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final client = context.read<ApiClient>();
      final res = await client.dio.get('/dashboard');
      setState(() {
        _stats = DashboardStats.fromJson(res.data);
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Could not load dashboard data';
        _loading = false;
      });
    }
  }

  String _formatCurrency(double amount) {
    return NumberFormat.currency(
      locale: 'en_IN',
      symbol: '₹',
      decimalDigits: 0,
    ).format(amount);
  }

  Widget _buildStatCard(String title, String value, IconData icon, Color color, String subtext) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(title, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
              Icon(icon, color: color, size: 18),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(subtext, style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Hi, ${auth.user?.name.split(' ').first ?? 'Agent'} 👋',
              style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const Text(
              'Overview & Collections',
              style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _fetchStats,
          ),
          IconButton(
            icon: const Icon(Icons.logout, color: Colors.white70),
            onPressed: () => auth.logout(),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF6366F1)))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(_error!, style: const TextStyle(color: Colors.redAccent)),
                      const SizedBox(height: 12),
                      ElevatedButton(
                        onPressed: _fetchStats,
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _fetchStats,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Top KPI Grid
                      GridView.count(
                        crossAxisCount: 2,
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        crossAxisSpacing: 12,
                        mainAxisSpacing: 12,
                        childAspectRatio: 1.35,
                        children: [
                          _buildStatCard(
                            'Total Receivables',
                            _formatCurrency(_stats?.totalReceivables ?? 0),
                            Icons.trending_up,
                            const Color(0xFF6366F1),
                            'Active invoices',
                          ),
                          _buildStatCard(
                            'Overdue Amount',
                            _formatCurrency(_stats?.overdueAmount ?? 0),
                            Icons.warning_amber_rounded,
                            const Color(0xFFEF4444),
                            'Needs action',
                          ),
                          _buildStatCard(
                            'Collected (Month)',
                            _formatCurrency(_stats?.collectedThisMonth ?? 0),
                            Icons.check_circle_outline,
                            const Color(0xFF10B981),
                            'Received funds',
                          ),
                          _buildStatCard(
                            'Collection Rate',
                            '${_stats?.collectionRate ?? 0}%',
                            Icons.pie_chart_outline,
                            const Color(0xFFF59E0B),
                            '${_stats?.openInvoiceCount ?? 0} invoices open',
                          ),
                        ],
                      ),
                      const SizedBox(height: 20),

                      // Secondary metrics
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1E293B),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFF334155)),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            Column(
                              children: [
                                Text('${_stats?.overdueCustomerCount ?? 0}',
                                    style: const TextStyle(color: Color(0xFFEF4444), fontSize: 20, fontWeight: FontWeight.bold)),
                                const SizedBox(height: 4),
                                const Text('Overdue Clients', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                              ],
                            ),
                            Container(width: 1, height: 36, color: const Color(0xFF334155)),
                            Column(
                              children: [
                                Text('${_stats?.openCaseCount ?? 0}',
                                    style: const TextStyle(color: Color(0xFF6366F1), fontSize: 20, fontWeight: FontWeight.bold)),
                                const SizedBox(height: 4),
                                const Text('Active Cases', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                              ],
                            ),
                            Container(width: 1, height: 36, color: const Color(0xFF334155)),
                            Column(
                              children: [
                                Text('${_stats?.openInvoiceCount ?? 0}',
                                    style: const TextStyle(color: Color(0xFFF59E0B), fontSize: 20, fontWeight: FontWeight.bold)),
                                const SizedBox(height: 4),
                                const Text('Open Invoices', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
    );
  }
}
