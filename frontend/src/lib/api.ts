import axios from 'axios'
import { getStoredToken } from '@/lib/auth'
import { API_BASE_URL as CONFIG_API_BASE_URL } from '@/config'

export const API_BASE_URL = CONFIG_API_BASE_URL

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
})

apiClient.interceptors.request.use((config) => {
  const token = getStoredToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('ocm_auth_token')
      window.location.reload()
    }
    return Promise.reject(error)
  }
)
