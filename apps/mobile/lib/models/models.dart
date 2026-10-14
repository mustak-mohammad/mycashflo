class User {
  final String id;
  final String email;
  final String name;
  final String role;
  final String tenantId;

  User({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    required this.tenantId,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] ?? '',
      email: json['email'] ?? '',
      name: json['name'] ?? '',
      role: json['role'] ?? 'AGENT',
      tenantId: json['tenantId'] ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'name': name,
        'role': role,
        'tenantId': tenantId,
      };
}

class Customer {
  final String id;
  final String name;
  final String email;
  final String phone;
  final String? company;
  final double outstandingBalance;
  final String status;

  Customer({
    required this.id,
    required this.name,
    required this.email,
    required this.phone,
    this.company,
    required this.outstandingBalance,
    required this.status,
  });

  factory Customer.fromJson(Map<String, dynamic> json) {
    return Customer(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      email: json['email'] ?? '',
      phone: json['phone'] ?? '',
      company: json['company'],
      outstandingBalance: (json['outstandingBalance'] as num?)?.toDouble() ?? 0.0,
      status: json['status'] ?? 'ACTIVE',
    );
  }
}

class Invoice {
  final String id;
  final String number;
  final String customerId;
  final String customerName;
  final double amount;
  final double outstanding;
  final String status;
  final String issueDate;
  final String dueDate;

  Invoice({
    required this.id,
    required this.number,
    required this.customerId,
    required this.customerName,
    required this.amount,
    required this.outstanding,
    required this.status,
    required this.issueDate,
    required this.dueDate,
  });

  factory Invoice.fromJson(Map<String, dynamic> json) {
    return Invoice(
      id: json['id'] ?? '',
      number: json['number'] ?? '',
      customerId: json['customerId'] ?? '',
      customerName: json['customer']?['name'] ?? 'Customer',
      amount: (json['amount'] as num?)?.toDouble() ?? 0.0,
      outstanding: (json['outstanding'] as num?)?.toDouble() ?? 0.0,
      status: json['status'] ?? 'OPEN',
      issueDate: json['issueDate'] ?? '',
      dueDate: json['dueDate'] ?? '',
    );
  }
}

class FollowUpTask {
  final String id;
  final String title;
  final String? description;
  final String dueDate;
  final String priority;
  final bool done;
  final String customerName;

  FollowUpTask({
    required this.id,
    required this.title,
    this.description,
    required this.dueDate,
    required this.priority,
    required this.done,
    required this.customerName,
  });

  factory FollowUpTask.fromJson(Map<String, dynamic> json) {
    return FollowUpTask(
      id: json['id'] ?? '',
      title: json['title'] ?? '',
      description: json['description'],
      dueDate: json['dueDate'] ?? '',
      priority: json['priority'] ?? 'MEDIUM',
      done: json['done'] ?? false,
      customerName: json['collectionCase']?['customer']?['name'] ?? 'General',
    );
  }
}

class DashboardStats {
  final double totalReceivables;
  final double overdueAmount;
  final double collectedThisMonth;
  final int openInvoiceCount;
  final int overdueCustomerCount;
  final int openCaseCount;
  final double collectionRate;

  DashboardStats({
    required this.totalReceivables,
    required this.overdueAmount,
    required this.collectedThisMonth,
    required this.openInvoiceCount,
    required this.overdueCustomerCount,
    required this.openCaseCount,
    required this.collectionRate,
  });

  factory DashboardStats.fromJson(Map<String, dynamic> json) {
    return DashboardStats(
      totalReceivables: (json['totalReceivables'] as num?)?.toDouble() ?? 0.0,
      overdueAmount: (json['overdueAmount'] as num?)?.toDouble() ?? 0.0,
      collectedThisMonth: (json['collectedThisMonth'] as num?)?.toDouble() ?? 0.0,
      openInvoiceCount: json['openInvoiceCount'] ?? 0,
      overdueCustomerCount: json['overdueCustomerCount'] ?? 0,
      openCaseCount: json['openCaseCount'] ?? 0,
      collectionRate: (json['collectionRate'] as num?)?.toDouble() ?? 0.0,
    );
  }
}
