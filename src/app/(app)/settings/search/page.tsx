import PageHeader from "@/components/layout/PageHeader";
import SearchProvidersScreen from "@/components/search/SearchProvidersScreen";

export default function SettingsSearchPage() {
  return (
    <>
      <PageHeader
        title="Search"
        description="Connect web search providers the model can call, and order the fallback chain."
      />
      <SearchProvidersScreen />
    </>
  );
}
