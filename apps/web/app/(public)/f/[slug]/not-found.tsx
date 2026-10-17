export default function FormNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">Form unavailable</h1>
        <p className="mt-2 text-slate-600">
          This form is not published, has been archived, or the address is
          incorrect.
        </p>
        <p className="mt-6 text-xs text-slate-500">
          Powered by{" "}
          <a
            className="font-medium hover:underline"
            href="https://github.com/0then0/form-forge"
            rel="noreferrer"
            target="_blank"
          >
            Form Forge
          </a>
        </p>
      </div>
    </main>
  );
}
