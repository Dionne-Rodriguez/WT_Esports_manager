import {TeamsDataTable} from "@/components/teams-data-table.tsx";
import data from "@/data/data.json"
import playersData from "@/data/playerData.json"
import {PlayersDataTable} from "@/components/players-data-table.tsx";

export default function Dashboard() {

    return (
        <div>
            <TeamsDataTable data={data} />
            <PlayersDataTable data={playersData} />
        </div>
    )
}
