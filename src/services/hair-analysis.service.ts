import { GoogleGenerativeAI } from '@google/generative-ai'

export const HAIR_TYPES    = ['straight', 'wavy', 'curly', 'coily'] as const
export const SERVICE_KEYS  = ['svcHaircut', 'svcBeard', 'svcScalpTreatment', 'svcColorTreatment', 'svcDeepConditioning'] as const
export const REC_KEYS      = [
  'rec_moisturize', 'rec_trim_regularly', 'rec_scalp_care',
  'rec_deep_condition', 'rec_reduce_heat', 'rec_protein_treatment', 'rec_oil_treatment',
] as const

export type HairType = typeof HAIR_TYPES[number]
export type AnalysisResult = {
  hairType:          HairType
  conditionScore:    number
  recommendations:   string[]
  suggestedServices: string[]
}

const PROMPT = `You are a professional hair and scalp analyst for a barbershop app.
Analyze the hair in this image carefully.
Respond ONLY with valid JSON (no markdown, no extra text):
{
  "hairType": one of ["straight","wavy","curly","coily"],
  "conditionScore": integer 0-100 (100=perfect condition, 0=severely damaged),
  "recommendations": array of 2-4 keys chosen from ["rec_moisturize","rec_trim_regularly","rec_scalp_care","rec_deep_condition","rec_reduce_heat","rec_protein_treatment","rec_oil_treatment"],
  "suggestedServices": array of 1-3 keys chosen from ["svcHaircut","svcBeard","svcScalpTreatment","svcColorTreatment","svcDeepConditioning"]
}`

export async function analyzeHairImage(imageBuffer: Buffer, mimeType: string): Promise<AnalysisResult> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const genAI  = new GoogleGenerativeAI(apiKey)
  const model  = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

  const res    = await model.generateContent([
    PROMPT,
    { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
  ])

  const raw    = res.response.text().trim().replace(/```json|```/g, '').trim()
  const json   = JSON.parse(raw)

  return {
    hairType:          HAIR_TYPES.includes(json.hairType)    ? json.hairType : 'straight',
    conditionScore:    Math.min(100, Math.max(0, Number(json.conditionScore) || 50)),
    recommendations:   (json.recommendations   as string[]).filter(r => (REC_KEYS as readonly string[]).includes(r)).slice(0, 4),
    suggestedServices: (json.suggestedServices as string[]).filter(s => (SERVICE_KEYS as readonly string[]).includes(s)).slice(0, 3),
  }
}
