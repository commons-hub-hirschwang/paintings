// Tiny formula language for admin-editable calculations (e.g. the price). Not Turing-complete on purpose:
// numbers, variables, + - * / % ^, parentheses and a fixed set of functions. No loops, no assignment, no code
// execution (no eval/new Function, so it also runs in Workers). Example:
//   max(80, round(600 * area_m2^0.8 * (rating / 5)^1.5, 10))

type Node =
	| { type: 'num'; value: number }
	| { type: 'var'; name: string }
	| { type: 'neg'; arg: Node }
	| { type: 'op'; op: string; left: Node; right: Node }
	| { type: 'call'; name: string; args: Node[] }

// round/floor/ceil take an optional step: round(x, 10) rounds to tens
const step = (fn: (x: number) => number) => (x: number, s = 1) => fn(x / s) * s
export const functions: Record<string, (...args: number[]) => number> = {
	min: Math.min,
	max: Math.max,
	round: step(Math.round),
	floor: step(Math.floor),
	ceil: step(Math.ceil),
	abs: Math.abs,
	sqrt: Math.sqrt,
	log: Math.log,
	exp: Math.exp,
}

const ops: Record<string, (a: number, b: number) => number> = {
	'+': (a, b) => a + b,
	'-': (a, b) => a - b,
	'*': (a, b) => a * b,
	'/': (a, b) => a / b,
	'%': (a, b) => a % b,
	'^': (a, b) => a ** b,
}

export class FormulaError extends Error {}

export function parse(source: string, variables: readonly string[]): Node {
	const tokens = [...source.matchAll(/\s*(?:(\d+(?:\.\d+)?|\.\d+)|([a-z_]\w*)|(\S))/gi)].map((m) => ({
		text: m[1] ?? m[2] ?? m[3] ?? '',
		kind: m[1] ? 'num' : m[2] ? 'name' : 'sym',
		at: m.index! + m[0].length - (m[1] ?? m[2] ?? m[3] ?? '').length,
	}))
	let i = 0
	const peek = () => tokens[i]
	const fail = (message: string): never => {
		throw new FormulaError(`${message} at position ${(peek()?.at ?? source.length) + 1}`)
	}
	const expect = (text: string) => (peek()?.text === text ? i++ : fail(`expected "${text}"`))

	// precedence: + - < * / % < unary - < ^ (right-associative)
	function sum(): Node {
		let node = product()
		while (peek() && '+-'.includes(peek()!.text)) node = { type: 'op', op: tokens[i++]!.text, left: node, right: product() }
		return node
	}
	function product(): Node {
		let node = unary()
		while (peek() && '*/%'.includes(peek()!.text)) node = { type: 'op', op: tokens[i++]!.text, left: node, right: unary() }
		return node
	}
	function unary(): Node {
		if (peek()?.text === '-') return i++, { type: 'neg', arg: unary() }
		if (peek()?.text === '+') return i++, unary()
		return power()
	}
	function power(): Node {
		const base = primary()
		return peek()?.text === '^' ? (i++, { type: 'op', op: '^', left: base, right: unary() }) : base
	}
	function primary(): Node {
		const token = peek() ?? fail('unexpected end')
		i++
		if (token.kind === 'num') return { type: 'num', value: Number(token.text) }
		if (token.text === '(') {
			const node = sum()
			expect(')')
			return node
		}
		if (token.kind === 'name') {
			if (peek()?.text === '(') {
				if (!functions[token.text]) i--, fail(`unknown function "${token.text}"`)
				i++
				const args: Node[] = []
				if (peek()?.text !== ')') {
					args.push(sum())
					while (peek()?.text === ',') i++, args.push(sum())
				}
				expect(')')
				return { type: 'call', name: token.text, args }
			}
			if (!variables.includes(token.text)) i--, fail(`unknown variable "${token.text}" (known: ${variables.join(', ')})`)
			return { type: 'var', name: token.text }
		}
		i--
		return fail(`unexpected "${token.text}"`)
	}

	if (!tokens.length) fail('empty formula')
	const node = sum()
	if (i < tokens.length) fail(`unexpected "${peek()!.text}"`)
	return node
}

export function evaluate(node: Node, vars: Record<string, number>): number {
	switch (node.type) {
		case 'num':
			return node.value
		case 'var':
			return vars[node.name]!
		case 'neg':
			return -evaluate(node.arg, vars)
		case 'op':
			return ops[node.op]!(evaluate(node.left, vars), evaluate(node.right, vars))
		case 'call':
			return functions[node.name]!(...node.args.map((arg) => evaluate(arg, vars)))
	}
}

// parse once, evaluate many times
export function compile(source: string, variables: readonly string[]) {
	const node = parse(source, variables)
	return (vars: Record<string, number>) => evaluate(node, vars)
}
