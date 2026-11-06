
import axios from 'axios'
import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig
} from 'axios'
import { supabase } from '@/services/supabase'

const API_BASE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json'
  }
})

/* ---------------- LOGGING HELPERS ---------------- */

const logRequest = (config: InternalAxiosRequestConfig) => {
  console.log('Request Data:', config.data ?? null)

}

const logResponse = (response: AxiosResponse) => {

  console.log('Response Data:', response.data)
}

const logError = (error: unknown) => {
  if (axios.isAxiosError(error)) {

    console.log('Response Data:', error.response?.data ?? null)

  } else {
    console.log('❌ Unexpected API Error:', error)
  }
}

/* ---------------- REQUEST INTERCEPTOR ---------------- */

apiClient.interceptors.request.use(
  async (config) => {
    try {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.log('❌ Failed to retrieve Supabase session:', error)
      }

      const token = data.session?.access_token

      if (token) {
        config.headers.set('Authorization', `Bearer ${token}`)
      }
    } catch (err) {
      console.log('❌ Error getting Supabase session:', err)
    }

    logRequest(config)

    return config
  },
  (error: unknown) => {
    logError(error)
    return Promise.reject(error)
  }
)

/* ---------------- RESPONSE INTERCEPTOR ---------------- */

apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    logResponse(response)
    return response
  },
  async (error: unknown) => {
    logError(error)

    if (axios.isAxiosError(error) && error.response?.status === 401) {
      console.warn('⚠️ Received 401 Unauthorized. Signing out of Supabase.')

      try {
        const { error: signOutError } = await supabase.auth.signOut()

        if (signOutError) {
          console.error('❌ Supabase sign-out failed:', signOutError)
        }
      } catch (signOutError) {
        console.error('❌ Error during Supabase sign-out:', signOutError)
      }
    }

    return Promise.reject(error)
  }
)

/* ---------------- API METHODS ---------------- */

const ApiService = {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return apiClient.get<T>(url, config).then((res) => res.data)
  },

  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    return apiClient.post<T>(url, data, config).then((res) => res.data)
  },

  put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    return apiClient.put<T>(url, data, config).then((res) => res.data)
  },

  patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    return apiClient.patch<T>(url, data, config).then((res) => res.data)
  },

  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return apiClient.delete<T>(url, config).then((res) => res.data)
  },

  upload<T = unknown>(url: string, payload: FormData): Promise<T> {
    return apiClient
      .post<T>(url, payload, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      .then((res) => res.data)
  }
}

export default ApiService
