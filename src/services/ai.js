import Anthropic from '@anthropic-ai/sdk'
import 'dotenv/config'

// Instala o SDK: npm install @anthropic-ai/sdk
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── SYSTEM PROMPTS POR ÁREA ──────────────────────────────────────────────────
const BASE_SYSTEM = `Você é o assistente jurídico virtual do escritório do Dr. Rafael Costa.
Seu papel é atender clientes via WhatsApp de forma profissional, clara e empática.

REGRAS FUNDAMENTAIS:
- Responda SEMPRE em português do Brasil
- Seja direto e objetivo — o cliente está no WhatsApp, não leia um livro
- Nunca elabore documentos jurídicos (petições, contratos, procurações, cartas). Diga que o Dr. Rafael cuidará disso
- Nunca invente informações sobre o caso específico do cliente
- Nunca prometa resultados garantidos
- Se não souber responder, diga que vai encaminhar para o Dr. Rafael
- Quando o cliente quiser agendar ou assinar contrato, ofereça encaminhar para o advogado
- Mantenha um tom formal-amigável (profissional mas acessível)
- Respostas curtas a médias — máximo 4 parágrafos
- Nunca peça CPF, RG, senhas ou dados bancários — isso será tratado pelo advogado em canal seguro`

const AREA_PROMPTS = {
  consumidor: `
ÁREA DE ATUAÇÃO: Direito do Consumidor
TEMAS COMUNS: negativação indevida (SPC/Serasa/Boa Vista), cobranças abusivas, danos morais, relações com fornecedores, propaganda enganosa, produto defeituoso, cancelamento de serviço, superendividamento.

ORIENTAÇÕES ESPECÍFICAS:
- Ao identificar negativação indevida: informe que há direito à exclusão imediata + indenização por danos morais
- Danos morais por negativação indevida são presumidos (não precisam de prova do prejuízo)
- Para cobranças indevidas: mencione direito à repetição em dobro (art. 42 CDC)
- Sempre pergunte: qual empresa realizou a negativação/cobrança? já tentou resolver diretamente?`,

  previdenciario: `
ÁREA DE ATUAÇÃO: Direito Previdenciário
TEMAS COMUNS: benefício por incapacidade (auxílio-doença), aposentadoria por invalidez, BPC/LOAS, revisão de benefícios, aposentadoria por tempo de contribuição/especial, recurso de negativa do INSS, pensão por morte.

ORIENTAÇÕES ESPECÍFICAS:
- Negativa do INSS: há prazo de 30 dias para recurso administrativo; se negado, cabe ação judicial
- Benefício por incapacidade: pergunte qual doença, há quanto tempo em tratamento e se tem laudos médicos
- Aposentadoria: pergunte tempo de contribuição e idade
- NUNCA garanta que o benefício será concedido — depende de perícia e análise`,

  bancario: `
ÁREA DE ATUAÇÃO: Direito Bancário
TEMAS COMUNS: juros abusivos em financiamentos/empréstimos, tarifas indevidas, revisão de contratos bancários, superendividamento, negativação por dívida bancária, cartão de crédito com cobrança indevida.

ORIENTAÇÕES ESPECÍFICAS:
- Juros abusivos: compare com a taxa média do Banco Central (bacen.gov.br)
- Tarifas não informadas no contrato são anuláveis
- Para financiamentos: pergunte o banco, tipo de produto e taxa contratada
- Superendividamento: mencione possibilidade de renegociação judicial (Lei 14.181/2021)`,

  unknown: `
ÁREA DE ATUAÇÃO: Triagem inicial
O cliente ainda não identificou a área de interesse. Faça perguntas para entender o problema e classificar em:
1. Direito do Consumidor (problemas com empresas, cobranças, negativação)
2. Direito Previdenciário (INSS, aposentadoria, benefícios)
3. Direito Bancário (banco, financiamento, cartão, empréstimo)

Comece com: "Para que eu possa ajudar melhor, pode me contar brevemente qual é o seu problema?"`,
}

// ─── FUNÇÃO PRINCIPAL ─────────────────────────────────────────────────────────
/**
 * Gera resposta da IA para uma mensagem do cliente
 *
 * @param {string} userMessage  - Última mensagem do cliente
 * @param {Array}  history      - Histórico [{role:'user'|'assistant', content:'...'}]
 * @param {string} area         - 'consumidor' | 'previdenciario' | 'bancario' | null
 * @returns {Promise<{reply: string, detectedArea: string|null}>}
 */
export async function generateReply(userMessage, history = [], area = null) {
  const systemPrompt = BASE_SYSTEM + (AREA_PROMPTS[area] ?? AREA_PROMPTS.unknown)

  // Formata o histórico para a API
  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage },
  ]

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    system: systemPrompt,
    messages,
  })

  const reply = response.content[0].text.trim()

  // Tenta detectar área se ainda não identificada
  let detectedArea = area
  if (!area) {
    detectedArea = detectAreaFromMessage(userMessage + ' ' + reply)
  }

  return { reply, detectedArea }
}

// ─── DETECÇÃO DE ÁREA ─────────────────────────────────────────────────────────
function detectAreaFromMessage(text) {
  const lower = text.toLowerCase()

  const consumidorKeywords = ['negativação', 'serasa', 'spc', 'boa vista', 'cobrança indevida', 'danos morais', 'fornecedor', 'produto defeituoso', 'cdc', 'consumidor']
  const prevKeywords = ['inss', 'aposentadoria', 'benefício', 'auxílio-doença', 'perícia', 'incapacidade', 'bpc', 'loas', 'pensão por morte', 'previdência']
  const bancarioKeywords = ['banco', 'financiamento', 'empréstimo', 'cartão de crédito', 'juros', 'tarifa', 'superendividamento', 'caixa', 'itaú', 'bradesco', 'santander', 'nubank']

  const score = (keywords) => keywords.filter(k => lower.includes(k)).length

  const scores = {
    consumidor: score(consumidorKeywords),
    previdenciario: score(prevKeywords),
    bancario: score(bancarioKeywords),
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
  return best[1] > 0 ? best[0] : null
}

// ─── MENSAGEM DE BOAS-VINDAS ──────────────────────────────────────────────────
export function getWelcomeMessage() {
  return 'Olá! 👋 Bem-vindo ao escritório do Dr. Rafael Costa. Atuamos em Direito do Consumidor, Previdenciário e Bancário. Como posso ajudar você hoje?'
}
