import { useState, type FormEvent } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import {
    Card,
    CardContent,
} from "@/components/ui/card"

export default function Login() {
    const [username, setUsername] = useState<string>("");
    const [password, setPassword] = useState<string>("");
    const [error, setError] = useState<string>("");
    const navigate = useNavigate();

    async function handleLogin(e: FormEvent) {
        e.preventDefault();
        try {
            const res = await axios.post<{ token: string }>("http://localhost:3000/api/login", {
                username,
                password,
            });
            localStorage.setItem("token", res.data.token);
            navigate("/dashboard");
        } catch (err) {
            setError("Invalid credentials");
        }
    }

    return (
        <div>
        <div className="flex min-h-screen items-center justify-center">
            <Card className="">
                <CardContent className="flex flex-col gap-4">
                    <h2 className="text-xl font-bold text-center">Admin Login</h2>
                    <form onSubmit={handleLogin} className="flex flex-col gap-4">
                        <Input
                            type="text"
                            placeholder="Username"
                            value={username}
                            onChange={(e: any) => setUsername(e.target.value)}
                            required
                        />
                        <Input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e: any) => setPassword(e.target.value)}
                            required
                        />
                        <Button type="submit" className="w-full">
                            Sign In
                        </Button>
                    </form>
                    {error && <div className="text-red-500 text-sm">{error}</div>}
                </CardContent>
            </Card>
        </div>
        </div>
            );
}
