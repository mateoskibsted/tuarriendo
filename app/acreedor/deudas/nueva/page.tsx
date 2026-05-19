import Link from 'next/link'

export default function NuevaDeudaPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="px-5 pt-8 pb-4">
        <Link href="/acreedor" className="text-sm text-gray-500 flex items-center gap-1">
          ← Volver
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-4">Nueva deuda</h1>
        <p className="text-gray-500 mt-1 text-sm">¿Qué tipo de deuda quieres registrar?</p>
      </div>

      <div className="px-5 pt-2 pb-8 flex flex-col gap-4">
        {/* Deuda Simple */}
        <Link
          href="/acreedor/deudas/nueva/simple"
          className="block bg-white rounded-2xl border-2 border-gray-200 p-6 active:border-blue-500 active:shadow-md transition-all"
        >
          <div className="flex items-start gap-4">
            <div className="text-4xl">👥</div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-900">Deuda Simple</h2>
              <p className="text-sm text-gray-500 mt-1">
                Un gasto puntual compartido entre varias personas. El bot avisa a cada uno al instante.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {['Cena grupal', 'Liga deportiva', 'Regalo compartido', 'Préstamo'].map(tag => (
                  <span key={tag} className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-gray-400">El deudor recibe mensaje inmediato</span>
            <span className="text-blue-600 font-bold text-lg">→</span>
          </div>
        </Link>

        {/* Deuda Recurrente */}
        <Link
          href="/acreedor/deudas/nueva/recurrente"
          className="block bg-white rounded-2xl border-2 border-gray-200 p-6 active:border-emerald-500 active:shadow-md transition-all"
        >
          <div className="flex items-start gap-4">
            <div className="text-4xl">🔄</div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-900">Deuda Recurrente</h2>
              <p className="text-sm text-gray-500 mt-1">
                Un cobro mensual con fecha fija. El bot envía recordatorios automáticos antes del vencimiento.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {['Arriendo', 'Clases mensuales', 'Cuota servicio', 'Suscripción'].map(tag => (
                  <span key={tag} className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-gray-400">Recordatorios 3, 2 y 1 día antes</span>
            <span className="text-emerald-600 font-bold text-lg">→</span>
          </div>
        </Link>
      </div>
    </div>
  )
}
