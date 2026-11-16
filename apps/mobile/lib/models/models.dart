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

// ── Phase 6: Collections Intelligence Models ─────────────────────────────────

class ActionProposal {
  final String id;
  final String toolName;
  final String summary;
  final String riskLevel;
  final String status;
  final String createdAt;
  final Map<String, dynamic> parameters;

  ActionProposal({
    required this.id,
    required this.toolName,
    required this.summary,
    required this.riskLevel,
    required this.status,
    required this.createdAt,
    required this.parameters,
  });

  factory ActionProposal.fromJson(Map<String, dynamic> json) {
    return ActionProposal(
      id: json['id'] ?? '',
      toolName: json['toolName'] ?? '',
      summary: json['summary'] ?? '',
      riskLevel: json['riskLevel'] ?? 'MEDIUM',
      status: json['status'] ?? 'PENDING',
      createdAt: json['createdAt'] ?? '',
      parameters: json['parameters'] != null ? Map<String, dynamic>.from(json['parameters']) : {},
    );
  }
}

class NotificationItem {
  final String id;
  final String customerId;
  final String customerName;
  final String channel;
  final String template;
  final String status;
  final String createdAt;

  NotificationItem({
    required this.id,
    required this.customerId,
    required this.customerName,
    required this.channel,
    required this.template,
    required this.status,
    required this.createdAt,
  });

  factory NotificationItem.fromJson(Map<String, dynamic> json) {
    return NotificationItem(
      id: json['id'] ?? '',
      customerId: json['customerId'] ?? '',
      customerName: json['customer']?['name'] ?? 'Customer',
      channel: json['channel'] ?? 'WHATSAPP',
      template: json['template'] ?? '',
      status: json['status'] ?? 'QUEUED',
      createdAt: json['createdAt'] ?? '',
    );
  }
}

class AuditLogItem {
  final String id;
  final String action;
  final String userName;
  final String? entityType;
  final String createdAt;

  AuditLogItem({
    required this.id,
    required this.action,
    required this.userName,
    this.entityType,
    required this.createdAt,
  });

  factory AuditLogItem.fromJson(Map<String, dynamic> json) {
    return AuditLogItem(
      id: json['id'] ?? '',
      action: json['action'] ?? '',
      userName: json['user']?['name'] ?? 'System',
      entityType: json['entityType'],
      createdAt: json['createdAt'] ?? '',
    );
  }
}

// ── Phase 7: Integration Models ──────────────────────────────────────────────

class PaymentLinkItem {
  final String paymentLinkId;
  final String provider;
  final String shortUrl;
  final double amount;
  final String currency;
  final String status;
  final bool isSimulated;

  PaymentLinkItem({
    required this.paymentLinkId,
    required this.provider,
    required this.shortUrl,
    required this.amount,
    required this.currency,
    required this.status,
    required this.isSimulated,
  });

  factory PaymentLinkItem.fromJson(Map<String, dynamic> json) {
    return PaymentLinkItem(
      paymentLinkId: json['paymentLinkId'] ?? json['id'] ?? '',
      provider: json['provider'] ?? 'RAZORPAY',
      shortUrl: json['shortUrl'] ?? json['url'] ?? '',
      amount: (json['amount'] as num?)?.toDouble() ?? 0.0,
      currency: json['currency'] ?? 'INR',
      status: json['status'] ?? 'CREATED',
      isSimulated: json['isSimulated'] ?? true,
    );
  }
}

class TelephonyCallSession {
  final String callSid;
  final String provider;
  final String status;
  final bool isSimulated;
  final String notes;

  TelephonyCallSession({
    required this.callSid,
    required this.provider,
    required this.status,
    required this.isSimulated,
    required this.notes,
  });

  factory TelephonyCallSession.fromJson(Map<String, dynamic> json) {
    return TelephonyCallSession(
      callSid: json['callSid'] ?? '',
      provider: json['provider'] ?? 'SIP_GATEWAY',
      status: json['status'] ?? 'SIMULATED',
      isSimulated: json['isSimulated'] ?? true,
      notes: json['notes'] ?? '',
    );
  }
}

// ── Document Delivery Models ──────────────────────────────────────────────────

class DeliveryAttemptItem {
  final String id;
  final String channel;
  final String destinationMasked;
  final String status;
  final String provider;
  final String? errorMessage;
  final String? sentAt;
  final String? deliveredAt;

  DeliveryAttemptItem({
    required this.id,
    required this.channel,
    required this.destinationMasked,
    required this.status,
    required this.provider,
    this.errorMessage,
    this.sentAt,
    this.deliveredAt,
  });

  factory DeliveryAttemptItem.fromJson(Map<String, dynamic> json) {
    return DeliveryAttemptItem(
      id: json['id'] ?? '',
      channel: json['channel'] ?? 'WHATSAPP',
      destinationMasked: json['destinationMasked'] ?? '****',
      status: json['status'] ?? 'PENDING',
      provider: json['provider'] ?? 'SIMULATOR',
      errorMessage: json['errorMessage'],
      sentAt: json['sentAt'],
      deliveredAt: json['deliveredAt'],
    );
  }
}

class DocumentDeliveryRequestItem {
  final String id;
  final String customerId;
  final String invoiceId;
  final String requestType;
  final String deliveryChannel;
  final String status;
  final String requestedBy;
  final String requestedAt;
  final List<DeliveryAttemptItem> attempts;

  DocumentDeliveryRequestItem({
    required this.id,
    required this.customerId,
    required this.invoiceId,
    required this.requestType,
    required this.deliveryChannel,
    required this.status,
    required this.requestedBy,
    required this.requestedAt,
    required this.attempts,
  });

  factory DocumentDeliveryRequestItem.fromJson(Map<String, dynamic> json) {
    var rawAttempts = json['attempts'] as List? ?? [];
    List<DeliveryAttemptItem> parsedAttempts = rawAttempts
        .map((a) => DeliveryAttemptItem.fromJson(a as Map<String, dynamic>))
        .toList();

    return DocumentDeliveryRequestItem(
      id: json['id'] ?? '',
      customerId: json['customerId'] ?? '',
      invoiceId: json['invoiceId'] ?? '',
      requestType: json['requestType'] ?? 'INVOICE',
      deliveryChannel: json['deliveryChannel'] ?? 'WHATSAPP_AND_EMAIL',
      status: json['status'] ?? 'PENDING',
      requestedBy: json['requestedBy'] ?? 'VOICE_AGENT',
      requestedAt: json['requestedAt'] ?? '',
      attempts: parsedAttempts,
    );
  }
}


