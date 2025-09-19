import React, { useCallback, useEffect, useId, useRef, useState } from 'react'

type PresignResponse = {
  url: string
  method?: string
  headers?: Record<string, string>
  key: string
  public_url: string
}

type UploadStage = 'idle' | 'signing' | 'uploading' | 'success' | 'error'

type UploadFieldProps = {
  onUploaded: (publicUrl: string) => void
  onError?: (message: string) => void
  onUploadStateChange?: (isUploading: boolean) => void
  accept?: string
}

export function UploadField({ onUploaded, onError, onUploadStateChange, accept }: UploadFieldProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<UploadStage>('idle')
  const [isDragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    onUploadStateChange?.(stage === 'signing' || stage === 'uploading')
  }, [stage, onUploadStateChange])

  const resetCopied = useCallback(() => {
    setCopied(false)
  }, [])

  const readError = useCallback(async (response: Response): Promise<string> => {
    const fallback = `Request failed (${response.status})`
    try {
      const text = await response.text()
      if (!text) return fallback
      const payload = JSON.parse(text)
      if (typeof payload?.detail === 'string') return payload.detail
      if (typeof payload?.error === 'string') return payload.error
      if (typeof payload?.message === 'string') return payload.message
      return fallback
    } catch (err) {
      if (err instanceof SyntaxError) return fallback
      return (err as Error).message || fallback
    }
  }, [])

  const performUpload = useCallback(
    async (file: File) => {
      setError(null)
      resetCopied()
      setStage('signing')
      setFileName(file.name)
      try {
        const presign = await fetch('/api/uploads/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, type: file.type || 'application/octet-stream' }),
        })

        if (!presign.ok) {
          throw new Error(await readError(presign))
        }

        const data = (await presign.json()) as PresignResponse
        if (!data?.url || !data?.public_url) {
          throw new Error('Presign response missing URL')
        }

        const method = (data.method || 'PUT').toUpperCase()
        const headers: Record<string, string> = {}
        if (data.headers) {
          for (const [key, value] of Object.entries(data.headers)) {
            if (typeof value === 'string') headers[key] = value
          }
        }
        if (!headers['Content-Type']) {
          headers['Content-Type'] = file.type || 'application/octet-stream'
        }

        setStage('uploading')
        const uploadResponse = await fetch(data.url, {
          method,
          headers,
          body: file,
        })

        if (!uploadResponse.ok) {
          throw new Error(await readError(uploadResponse))
        }

        setUploadedUrl(data.public_url)
        setStage('success')
        onUploaded(data.public_url)
      } catch (err: any) {
        const message = err?.message || 'Upload failed'
        setError(message)
        setStage('error')
        onError?.(message)
      }
    },
    [onUploaded, onError, readError, resetCopied],
  )

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      const [file] = Array.from(files)
      if (!file) return
      void performUpload(file)
      if (inputRef.current) {
        inputRef.current.value = ''
      }
    },
    [performUpload],
  )

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    handleFiles(event.dataTransfer.files)
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if ((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) return
    setDragging(false)
  }

  const openPicker = () => {
    inputRef.current?.click()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPicker()
    }
  }

  const handleCopy = useCallback(async () => {
    if (!uploadedUrl) return
    try {
      await navigator.clipboard?.writeText(uploadedUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch (err) {
      const message = (err as Error)?.message || 'Copy failed'
      onError?.(message)
    }
  }, [uploadedUrl, onError])

  const prompt = (() => {
    if (stage === 'signing') return 'Requesting upload slot…'
    if (stage === 'uploading') return `Uploading ${fileName || 'file'}…`
    if (stage === 'success') return fileName ? `${fileName} uploaded` : 'Upload complete'
    return 'Drop a file here or click to choose'
  })()

  return (
    <div className="agent-field upload-field">
      <label htmlFor={inputId}>Upload artifact file</label>
      <div
        role="button"
        tabIndex={0}
        className={`upload-field__dropzone ${isDragging ? 'is-dragging' : ''} ${stage === 'uploading' ? 'is-uploading' : ''}`}
        onClick={openPicker}
        onKeyDown={handleKeyDown}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        aria-describedby={`${inputId}-hint`}
      >
        <span className="upload-field__prompt">{prompt}</span>
        <span id={`${inputId}-hint`} className="upload-field__hint">
          {accept ? `Supported: ${accept}` : 'Max 100 MB (S3 limits apply)'}
        </span>
      </div>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={event => handleFiles(event.target.files)}
      />
      {stage === 'success' && uploadedUrl ? (
        <>
          <p className="upload-field__status" aria-live="polite">
            <span className="upload-field__badge">
              Uploaded <span aria-hidden="true">✓</span>
            </span>
            <button type="button" className={`ghost upload-field__copy ${copied ? 'is-copied' : ''}`} onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          </p>
          <p className="upload-field__note">Stored in your bucket; URL is public.</p>
        </>
      ) : null}
      {stage === 'error' && error ? (
        <p className="upload-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
