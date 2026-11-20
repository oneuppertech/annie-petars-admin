
import { handle, reply, requireMethod, text, HttpError } from '../_shared/http.ts'
import { getAdminClient } from '../_shared/supabaseAdmin.ts'
import { notify } from '../_shared/customRequestNotify.ts'

const BUCKET = 'custom-request-files'
const MAX_FILES = 5
const MAX_FILE_SIZE = 8 * 1024 * 1024

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
])

function jsonObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function validDate(value: string) {
  if (!value) return null

  const date = new Date(`${value}T00:00:00`)

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'Invalid required-by date.')
  }

  return value
}

function getExtension(file: File) {
  const name = file.name || ''
  const extension = name.includes('.')
    ? name.split('.').pop()?.toLowerCase()
    : ''

  const allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf']

  if (extension && allowed.includes(extension)) {
    return extension
  }

  const fallback: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
  }

  return fallback[file.type] || 'bin'
}

async function submitRequest(
  req: Request,
  cors: Record<string, string>,
){
  requireMethod(req, 'POST')

  const contentType = req.headers.get('content-type') || ''

  if (!contentType.includes('multipart/form-data')) {
    throw new HttpError(400, 'Please submit the request as multipart form data.')
  }

  const form = await req.formData()

  const name = text(form.get('name'))
  const email = text(form.get('email')).toLowerCase()
  const phone = text(form.get('phone'))
  const country = text(form.get('country'))
  const outfitType = text(form.get('outfit'))
  const fabricPreference = text(form.get('fabric'))
  const colourPreference = text(form.get('colour'))
  const neededBy = validDate(text(form.get('needBy')))
  const notes = text(form.get('notes'))
  const measurementUnit = text(form.get('unit')) || 'cm'
  const garmentType = text(form.get('garment')) || 'dress'

  const accuracyConfirmed = form.get('accurate') === 'true'
  const termsAccepted = form.get('terms') === 'true'

  if (!name || !email || !outfitType) {
    throw new HttpError(400, 'Name, email and outfit type are required.')
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Please provide a valid email address.')
  }

  if (!['cm', 'in'].includes(measurementUnit)) {
    throw new HttpError(400, 'Invalid measurement unit.')
  }

  if (!['dress', 'trouser'].includes(garmentType)) {
    throw new HttpError(400, 'Invalid garment type.')
  }

  if (!accuracyConfirmed || !termsAccepted) {
    throw new HttpError(
      400,
      'Please confirm your measurements and accept the terms.',
    )
  }

  let measurements: Record<string, unknown> = {}

  const rawMeasurements = form.get('measurements')

  if (typeof rawMeasurements === 'string' && rawMeasurements.trim()) {
    try {
      measurements = jsonObject(JSON.parse(rawMeasurements))
    } catch {
      throw new HttpError(400, 'Invalid measurements data.')
    }
  }

  const files = form.getAll('files').filter(
    (item): item is File => item instanceof File && item.size > 0,
  )

  if (files.length > MAX_FILES) {
    throw new HttpError(400, `You can upload a maximum of ${MAX_FILES} files.`)
  }

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      throw new HttpError(400, `${file.name} exceeds the 8 MB file limit.`)
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      throw new HttpError(
        400,
        `${file.name} has an unsupported file type.`,
      )
    }
  }

  const supabase = getAdminClient()

  const { data: request, error: insertError } = await supabase
    .from('custom_requests')
    .insert({
      name,
      email,
      phone: phone || null,
      country: country || null,
      outfit_type: outfitType,
      garment_type: garmentType,
      fabric_preference: fabricPreference || null,
      colour_preference: colourPreference || null,
      needed_by: neededBy,
      measurement_unit: measurementUnit,
      measurements,
      notes: notes || null,
      status: 'new',
      terms_accepted: true,
      accuracy_confirmed: true,
    })
    .select('*')
.single()

  if (insertError || !request) {
    console.error('Custom request insert failed:', insertError)
    throw new HttpError(500, 'Unable to submit your custom request.')
  }

  const uploadedPaths: string[] = []

  try {
    for (const file of files) {
      const extension = getExtension(file)
      const storagePath = `${request.id}/${crypto.randomUUID()}.${extension}`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false,
        })

      if (uploadError) {
        throw uploadError
      }

      uploadedPaths.push(storagePath)

      const { error: fileInsertError } = await supabase
        .from('custom_request_files')
        .insert({
          request_id: request.id,
          storage_path: storagePath,
          original_name: file.name,
          content_type: file.type || null,
          size_bytes: file.size,
        })

      if (fileInsertError) {
        throw fileInsertError
      }
    }

    const { error: eventError } = await supabase
      .from('custom_request_events')
      .insert({
        request_id: request.id,
        event_type: 'status',
        from_status: null,
        to_status: 'new',
        note: 'Custom request submitted by customer.',
        metadata: {},
      })

    if (eventError) {
      throw eventError
    }
  } catch (error) {
    console.error('Custom request attachment/event failure:', error)

    if (uploadedPaths.length) {
      await supabase.storage.from(BUCKET).remove(uploadedPaths)
    }

    await supabase
      .from('custom_request_files')
      .delete()
      .eq('request_id', request.id)

    await supabase
      .from('custom_request_events')
      .delete()
      .eq('request_id', request.id)

    await supabase
      .from('custom_requests')
      .delete()
      .eq('id', request.id)

    throw new HttpError(500, 'Your request could not be completed. Please try again.')
  }

  // Notify the customer after the request and attachments have been saved.
  try {
    const notification = notify('received', request)

    if (typeof EdgeRuntime !== 'undefined') {
      EdgeRuntime.waitUntil(notification)
    } else {
      await notification
    }
  } catch (error) {
    // A notification failure should not undo a successfully submitted request.
    console.error('Custom request notification failed:', error)
  }

 return reply(
  cors,
  {
    success: true,
    message: 'Your custom request has been submitted successfully.',
    request: {
      id: request.id,
      request_number: request.request_number,
      public_token: request.public_token,
      status: request.status,
    },
  },
  200,
)
}

Deno.serve(handle(submitRequest))
