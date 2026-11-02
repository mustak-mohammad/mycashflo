import { IsString, IsOptional, IsNumber, IsEmail, IsArray, ValidateNested, Min, Matches, IsBoolean, ValidateIf, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompanyProfileDto {
  @ApiPropertyOptional({ example: 'Acme Technologies Pvt Ltd' })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({ example: 'Acme Technologies Private Limited' })
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiPropertyOptional({ example: '29ABCDE1234F1Z5', description: '15-character Indian GSTIN or alphanumeric Tax ID' })
  @IsOptional()
  @ValidateIf((o) => typeof o.gstin === 'string' && o.gstin.trim().length > 0)
  @Matches(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}|[A-Za-z0-9]{8,20})$/i, {
    message: 'Invalid GSTIN / Tax ID format. Expected 15-character Indian GSTIN (e.g. 29ABCDE1234F1Z5) or valid alphanumeric Tax ID (8-20 characters).',
  })
  gstin?: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F', description: '10-character Indian PAN or business tax number' })
  @IsOptional()
  @ValidateIf((o) => typeof o.pan === 'string' && o.pan.trim().length > 0)
  @Matches(/^([A-Z]{5}[0-9]{4}[A-Z]{1}|[A-Za-z0-9]{8,15})$/i, {
    message: 'Invalid PAN format. Expected 10-character Indian PAN (e.g. ABCDE1234F) or valid alphanumeric PAN (8-15 characters).',
  })
  pan?: string;

  @ApiPropertyOptional({ example: '123 MG Road, Bengaluru, Karnataka 560001' })
  @IsOptional()
  @IsString()
  billingAddress?: string;

  @ApiPropertyOptional({ example: '123 MG Road' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Bengaluru' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Karnataka' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: '560001' })
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'finance@acmetech.in' })
  @IsOptional()
  @ValidateIf((o) => typeof o.email === 'string' && o.email.trim().length > 0)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'finance@acmetech.in' })
  @IsOptional()
  @ValidateIf((o) => typeof o.contactEmail === 'string' && o.contactEmail.trim().length > 0)
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ example: 'https://acmetech.in' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ example: 'INR', default: 'INR' })
  @IsOptional()
  @IsString()
  currency?: string = 'INR';

  @ApiPropertyOptional({ example: '04-01', description: 'Financial year start date (MM-DD)' })
  @IsOptional()
  @IsString()
  financialYearStart?: string = '04-01';

  @ApiPropertyOptional({ example: 30, default: 30, description: 'Default payment terms in days' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultCreditDays?: number = 30;

  @ApiPropertyOptional({ example: 30, default: 30, description: 'Default payment terms in days' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultPaymentTerms?: number;

  @ApiPropertyOptional({ example: 30, default: 30, description: 'Default payment terms in days' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultPaymentTermsDays?: number;

  @ApiPropertyOptional({ description: 'Contact channel preferences' })
  @IsOptional()
  @IsObject()
  contactPreferences?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Configuration flag' })
  @IsOptional()
  @IsBoolean()
  isConfigured?: boolean;
}

export class ImportCustomerItemDto {
  @ApiProperty({ example: 'Raj Enterprises' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'raj@rajent.in' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  phone: string;

  @ApiPropertyOptional({ example: 'Raj Enterprises Pvt Ltd' })
  @IsOptional()
  @IsString()
  company?: string;

  @ApiPropertyOptional({ example: '29AAACH7409R1ZZ' })
  @IsOptional()
  @IsString()
  gstNumber?: string;

  @ApiPropertyOptional({ example: '45 Commercial Street, Bengaluru' })
  @IsOptional()
  @IsString()
  billingAddress?: string;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  openingBalance?: number = 0;
}

export class ImportInvoiceItemDto {
  @ApiProperty({ example: 'INV-2026-001' })
  @IsString()
  number: string;

  @ApiProperty({ example: 'raj@rajent.in', description: 'Customer reference: email, phone, or name' })
  @IsString()
  customerRef: string;

  @ApiProperty({ example: 50000 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ example: '2026-09-01' })
  @IsString()
  issueDate: string;

  @ApiProperty({ example: '2026-09-30' })
  @IsString()
  dueDate: string;

  @ApiPropertyOptional({ example: 'Software development services Q3' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'INR', default: 'INR' })
  @IsOptional()
  @IsString()
  currency?: string = 'INR';
}

export class ImportPaymentItemDto {
  @ApiProperty({ example: 'PAY-UTR-987654321' })
  @IsString()
  reference: string;

  @ApiProperty({ example: 'INV-2026-001' })
  @IsString()
  invoiceNumber: string;

  @ApiProperty({ example: 25000 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ example: '2026-10-05' })
  @IsString()
  paymentDate: string;

  @ApiPropertyOptional({ example: 'NEFT', default: 'NEFT' })
  @IsOptional()
  @IsString()
  paymentMethod?: string = 'NEFT';
}

export class BatchFinancialImportDto {
  @ApiPropertyOptional({ type: [ImportCustomerItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCustomerItemDto)
  customers?: ImportCustomerItemDto[];

  @ApiPropertyOptional({ type: [ImportInvoiceItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportInvoiceItemDto)
  invoices?: ImportInvoiceItemDto[];

  @ApiPropertyOptional({ type: [ImportPaymentItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportPaymentItemDto)
  payments?: ImportPaymentItemDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  recalculateBalances?: boolean = true;
}

export class CsvImportDto {
  @ApiProperty({ description: 'CSV type: CUSTOMERS, INVOICES, or PAYMENTS' })
  @IsString()
  type: 'CUSTOMERS' | 'INVOICES' | 'PAYMENTS';

  @ApiProperty({ description: 'Raw CSV text with header row' })
  @IsString()
  csvContent: string;
}
