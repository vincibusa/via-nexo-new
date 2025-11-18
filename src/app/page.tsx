import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function Home() {
  return (
    <div className="container mx-auto flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-4xl font-bold">Nexo</CardTitle>
          <CardDescription className="text-lg">
            Pannello di gestione per locali, eventi e raccomandazioni
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Pannello Amministrazione</h2>
            <p className="text-sm text-muted-foreground">
              Questo è il pannello di amministrazione Nexo, riservato ad amministratori e manager
              per la gestione di locali, eventi e utenti.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">👥 Per Manager</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Gestisci i tuoi locali e eventi, visualizza analytics e metriche di performance.
                </p>
                <Button asChild className="w-full">
                  <Link href="/login">Accedi come Manager</Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">🔐 Per Admin</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Accesso completo al sistema: gestione utenti, approvazione manager e analytics
                  globali.
                </p>
                <Button asChild className="w-full" variant="outline">
                  <Link href="/login">Accedi come Admin</Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50 p-4">
            <h3 className="mb-2 font-semibold text-blue-900 dark:text-blue-100">ℹ️ Richiedi accesso Manager</h3>
            <p className="text-sm text-blue-800 dark:text-blue-200">
              Se gestisci un locale e vuoi essere presente sulla piattaforma Nexo, contatta un
              amministratore per richiedere l&apos;accesso come manager.
            </p>
          </div>

          <div className="text-center text-xs text-muted-foreground">
            <p>Nexo © 2025 - Sistema di raccomandazione contestuale con AI</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
