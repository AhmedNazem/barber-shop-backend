import { GoogleGenerativeAI } from '@google/generative-ai'

export const HAIR_TYPES = ['straight', 'wavy', 'curly', 'coily'] as const

export type HairType = typeof HAIR_TYPES[number]
export type AnalysisResult = {
  hairType:          HairType
  conditionScore:    number
  recommendations:   string[]
  suggestedServices: string[]
}

function buildPrompt(locale: string): string {
  const lang = locale === 'ar' ? 'Arabic' : 'English'
  return `You are a professional hair and scalp analyst for a barbershop app.
Analyze the hair in this image carefully.
Respond ONLY with valid JSON (no markdown, no extra text).
Write "recommendations" and "suggestedServices" in ${lang}.
{
  "hairType": one of ["straight","wavy","curly","coily"],
  "conditionScore": integer 0-100 (100=perfect condition, 0=severely damaged),
  "recommendations": array of 2-4 specific hair care tips as complete sentences in ${lang},
  "suggestedServices": array of 1-3 barbershop service names in ${lang} (e.g. haircut, beard trim, scalp treatment)
}`
}

export async function analyzeHairImage(imageBuffer: Buffer, mimeType: string, locale = 'en'): Promise<AnalysisResult> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

  const res   = await model.generateContent([
    buildPrompt(locale),
    { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
  ])

  const raw  = res.response.text().trim().replace(/```json|```/g, '').trim()
  const json = JSON.parse(raw)

  return {
    hairType:          HAIR_TYPES.includes(json.hairType) ? json.hairType : 'straight',
    conditionScore:    Math.min(100, Math.max(0, Number(json.conditionScore) || 50)),
    recommendations:   (Array.isArray(json.recommendations)   ? json.recommendations   : []).slice(0, 4),
    suggestedServices: (Array.isArray(json.suggestedServices)  ? json.suggestedServices : []).slice(0, 3),
  }
}
