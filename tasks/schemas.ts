/**
 * JSON Schemas for structured extraction, keyed by document type.
 * Each schema defines the fields LlamaExtract should pull from that type.
 * Add new entries here to support additional document categories.
 */

export type SchemaValue = string | number | boolean | unknown[] | { [key: string]: unknown } | null;
export type DataSchema = { [key: string]: SchemaValue };

export const SCHEMAS: Record<string, DataSchema> = {
  invoice: {
    type: "object",
    properties: {
      invoice_number: { type: "string", description: "Invoice or reference number" },
      vendor_name: { type: "string", description: "Name of the vendor or seller" },
      invoice_date: { type: "string", description: "Date the invoice was issued" },
      due_date: { type: "string", description: "Payment due date" },
      total_amount: { type: "string", description: "Total amount due including currency" },
      line_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantity: { type: "string" },
            unit_price: { type: "string" },
            amount: { type: "string" },
          },
        },
        description: "Individual line items on the invoice",
      },
    } as Record<string, unknown>,
  },
  contract: {
    type: "object",
    properties: {
      title: { type: "string", description: "Contract title or name" },
      parties: { type: "array", items: { type: "string" }, description: "Names of the contracting parties" },
      effective_date: { type: "string", description: "When the contract takes effect" },
      expiration_date: { type: "string", description: "When the contract expires" },
      key_terms: { type: "array", items: { type: "string" }, description: "Important terms or clauses" },
      governing_law: { type: "string", description: "Jurisdiction governing the contract" },
    } as Record<string, unknown>,
  },
  resume: {
    type: "object",
    properties: {
      name: { type: "string", description: "Candidate full name" },
      email: { type: "string", description: "Contact email" },
      phone: { type: "string", description: "Contact phone number" },
      summary: { type: "string", description: "Professional summary or objective" },
      experience: {
        type: "array",
        items: {
          type: "object",
          properties: {
            company: { type: "string" },
            title: { type: "string" },
            dates: { type: "string" },
            highlights: { type: "array", items: { type: "string" } },
          },
        },
      },
      education: {
        type: "array",
        items: {
          type: "object",
          properties: {
            institution: { type: "string" },
            degree: { type: "string" },
            year: { type: "string" },
          },
        },
      },
      skills: { type: "array", items: { type: "string" } },
    } as Record<string, unknown>,
  },
  receipt: {
    type: "object",
    properties: {
      store_name: { type: "string" },
      date: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            price: { type: "string" },
          },
        },
      },
      subtotal: { type: "string" },
      tax: { type: "string" },
      total: { type: "string" },
      payment_method: { type: "string" },
    } as Record<string, unknown>,
  },
  financial: {
    type: "object",
    properties: {
      document_type: { type: "string", description: "Specific financial document type (bank statement, tax form, etc.)" },
      institution: { type: "string" },
      period: { type: "string", description: "Statement period or tax year" },
      account_info: { type: "string" },
      key_figures: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
          },
        },
        description: "Important monetary figures (balances, totals, income, etc.)",
      },
    } as Record<string, unknown>,
  },
};
