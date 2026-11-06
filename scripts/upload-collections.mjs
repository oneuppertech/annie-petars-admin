
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env'
  )
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

// Change this if your images are stored somewhere else.
const ASSETS_DIR = path.resolve('public/assets')
const BUCKET = 'collections'

const collections = [
  {
    slug: 'ready-to-wear',
    file: 'rtw.png'
  },
  {
    slug: 'african-suits',
    file: 'contemporary.png'
  },
  {
    slug: 'bridal',
    file: 'fob.png'
  },
  {
    slug: 'aso-ebi',
    file: 'aso-ebi.png'
  },
  {
    slug: 'made-to-measure',
    file: 'mtm.png'
  },
  {
    slug: 'stand-official-001',
    file: 'stand.png'
  },
  {
    slug: 'girl-child',
    file: 'girl-child.png'
  },
  {
    slug: 'new-arrivals',
    file: 'new-design.png'
  }
]

function getContentType(file) {
  const extension = path.extname(file).toLowerCase()

  const types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif'
  }

  return types[extension] ?? 'application/octet-stream'
}

async function uploadCollectionImage(collection) {
  const localPath = path.join(ASSETS_DIR, collection.file)
  const storagePath = collection.file
  const fileBuffer = await readFile(localPath)

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: getContentType(collection.file),
      upsert: true,
      cacheControl: '3600'
    })

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`)
  }

  const { data } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(storagePath)

  const publicUrl = data.publicUrl

  const { data: updatedRows, error: updateError } = await supabase
    .from('collections')
    .update({ image_url: publicUrl })
    .eq('slug', collection.slug)
    .select('id, slug, image_url')

  if (updateError) {
    throw new Error(`Database update failed: ${updateError.message}`)
  }

  if (!updatedRows || updatedRows.length === 0) {
    throw new Error(
      `No collection found with slug "${collection.slug}". ` +
      'Upload succeeded, but its database row was not updated.'
    )
  }

  console.log(`✓ ${collection.slug}`)
  console.log(`  File: ${localPath}`)
  console.log(`  URL:  ${publicUrl}`)

  return publicUrl
}

async function main() {
  console.log('Starting collection image uploads...\n')

  let succeeded = 0
  const failed = []

  for (const collection of collections) {
    try {
      await uploadCollectionImage(collection)
      succeeded++
    } catch (error) {
      failed.push({
        slug: collection.slug,
        message: error.message
      })

      console.error(`✗ ${collection.slug}: ${error.message}`)
    }
  }

  console.log('\n------------------------------')
  console.log(`Successful: ${succeeded}/${collections.length}`)
  console.log(`Failed: ${failed.length}/${collections.length}`)

  if (failed.length > 0) {
    console.error('\nFailed collections:')
    for (const item of failed) {
      console.error(`- ${item.slug}: ${item.message}`)
    }

    process.exitCode = 1
  } else {
    console.log('All collection images uploaded successfully.')
  }
}

main().catch((error) => {
  console.error('Upload process failed:', error.message)
  process.exitCode = 1
})
