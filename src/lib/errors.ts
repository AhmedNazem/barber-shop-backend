export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(code)
    this.name = 'AppError'
  }
}

// Bilingual error messages — error handler picks based on Accept-Language
export const ERROR_MESSAGES: Record<string, { en: string; ar: string }> = {
  invalid_credentials:  { en: 'Invalid credentials',           ar: 'بيانات غير صحيحة' },
  invalid_otp:          { en: 'Invalid OTP code',              ar: 'رمز التحقق غير صحيح' },
  otp_expired:          { en: 'OTP code has expired',          ar: 'انتهت صلاحية رمز التحقق' },
  otp_locked:           { en: 'Too many attempts, try later',  ar: 'محاولات كثيرة، حاول لاحقاً' },
  rate_limited:         { en: 'Too many requests',             ar: 'طلبات كثيرة جداً' },
  unauthorized:         { en: 'Authentication required',       ar: 'يجب تسجيل الدخول' },
  forbidden:            { en: 'Access denied',                 ar: 'غير مصرح لك' },
  not_found:            { en: 'Resource not found',            ar: 'المورد غير موجود' },
  conflict:             { en: 'Resource already exists',       ar: 'المورد موجود مسبقاً' },
  already_reviewed:     { en: 'Booking already reviewed',      ar: 'تم تقييم هذا الحجز مسبقاً' },
  too_late_to_cancel:   { en: 'Too late to cancel',            ar: 'فات وقت الإلغاء' },
  plan_required:        { en: 'Plan upgrade required',         ar: 'يتطلب اشتراكاً أعلى' },
  booking_disabled:     { en: 'Booking is disabled',           ar: 'الحجز غير متاح' },
  customer_blocked:     { en: 'Account is blocked',            ar: 'الحساب محظور' },
  shop_pending:         { en: 'Shop is pending approval',      ar: 'المحل قيد المراجعة' },
  shop_rejected:        { en: 'Shop application was rejected', ar: 'تم رفض طلب المحل' },
  shop_suspended:       { en: 'Shop is suspended',             ar: 'المحل موقوف' },
  name_required:        { en: 'Name is required for registration', ar: 'الاسم مطلوب للتسجيل' },
  user_not_found:       { en: 'No account found for this phone', ar: 'لا يوجد حساب لهذا الرقم' },
  already_registered:   { en: 'An account already exists for this phone', ar: 'يوجد حساب مسبق لهذا الرقم' },
  file_too_large:       { en: 'File exceeds maximum size (5 MB)', ar: 'حجم الملف يتجاوز الحد المسموح (5 ميغابايت)' },
  invalid_mime:         { en: 'Only JPEG, PNG and WebP images are allowed', ar: 'يُسمح فقط بصور JPEG وPNG وWebP' },
  file_required:        { en: 'No file was uploaded',            ar: 'لم يتم رفع أي ملف' },
  internal_error:       { en: 'Something went wrong',          ar: 'حدث خطأ ما' },
}
