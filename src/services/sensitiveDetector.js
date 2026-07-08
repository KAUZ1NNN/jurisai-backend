/**
 * Detector de conteúdo sensível
 *
 * Roda em TODA mensagem de saída da IA antes de enviar.
 * Se detectar algo, a mensagem vira alerta ao invés de ser enviada.
 *
 * Retorna: { flagged: boolean, reason: string|null, type: string|null }
 */

// ─── PADRÕES DE DADOS PESSOAIS ────────────────────────────────────────────────
const PATTERNS = {
  cpf: {
    regex: /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/,
    description: 'CPF detectado',
  },
  rg: {
    regex: /\b(rg|registro geral)\b/i,
    description: 'Menção a RG',
  },
  bank_account: {
    regex: /\b(conta corrente|conta poupança|agência|número da conta|dados bancários)\b/i,
    description: 'Dados bancários solicitados',
  },
  password: {
    regex: /\b(senha|pin|token de acesso)\b/i,
    description: 'Solicitação de senha ou token',
  },
}

// ─── PADRÕES DE DOCUMENTOS JURÍDICOS ─────────────────────────────────────────
const DOCUMENT_PATTERNS = [
  /\b(petição|peticao)\b/i,
  /\b(carta de (concessão|concessao|negativa|apresentação))\b/i,
  /\b(contrato|minuta)\b/i,
  /\b(procuração|procuracao)\b/i,
  /\b(recurso (administrativo|judicial))\b/i,
  /\b(laudo|parecer jurídico|parecer juridico)\b/i,
  /\b(termo de (acordo|audiência|audiencia))\b/i,
  /\b(notificação extrajudicial|notificacao extrajudicial)\b/i,
  /\b(elaborar|redigir|preparar|escrever).{0,30}(documento|contrato|petição|recurso)\b/i,
]

// ─── PADRÕES DE VALORES MONETÁRIOS EM PROPOSTAS ───────────────────────────────
const MONETARY_PROPOSAL_PATTERNS = [
  /\b(honorários|honorarios).{0,20}(r\$|\d)/i,
  /\bcobro.{0,30}(r\$|\d{3,})/i,
  /\b(proposta|orçamento|orcamento).{0,30}(r\$|\d{3,})/i,
]

// ─── DETECTOR PRINCIPAL ───────────────────────────────────────────────────────
export function detectSensitive(text) {
  // 1. Verifica solicitação de CPF explícita
  const cpfRequest = /\b(informe|poderia.{0,15}informar|me (passe|diga|envie|forneça|forneca)|pode(ria)? (me )?(passar|informar|enviar|fornecer)).{0,40}(cpf|documento|rg)\b/i
  if (cpfRequest.test(text)) {
    return {
      flagged: true,
      type: 'sensitive_data',
      reason: 'A mensagem solicita o CPF do cliente — dado pessoal sensível sujeito à LGPD.',
    }
  }

  // 2. Verifica padrões de dados pessoais
  for (const [key, { regex, description }] of Object.entries(PATTERNS)) {
    if (regex.test(text)) {
      return {
        flagged: true,
        type: 'sensitive_data',
        reason: `${description} na mensagem — dado pessoal sensível sujeito à LGPD.`,
      }
    }
  }

  // 3. Verifica documentos jurídicos
  for (const pattern of DOCUMENT_PATTERNS) {
    if (pattern.test(text)) {
      return {
        flagged: true,
        type: 'document',
        reason: 'A mensagem envolve elaboração de documento jurídico — responsabilidade exclusiva do advogado.',
      }
    }
  }

  // 4. Verifica propostas com valores monetários
  for (const pattern of MONETARY_PROPOSAL_PATTERNS) {
    if (pattern.test(text)) {
      return {
        flagged: true,
        type: 'sensitive_data',
        reason: 'A mensagem inclui valores de honorários ou proposta financeira — requer revisão do advogado.',
      }
    }
  }

  return { flagged: false, type: null, reason: null }
}
