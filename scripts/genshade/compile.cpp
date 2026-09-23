// Build-time adapter for the BSD-3-Clause ReShade FX compiler.
#include "effect_parser.hpp"
#include "effect_codegen.hpp"
#include "effect_preprocessor.hpp"
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <cmath>
static std::string quote(const std::string &s) {
    std::ostringstream o; o << '"';
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') o << '\\' << c;
        else if (c < 32) { const char *hex="0123456789abcdef"; o << "\\u00" << hex[c>>4] << hex[c&15]; }
        else o << c;
    }
    o << '"'; return o.str();
}
static std::string value(const reshadefx::constant &v, const reshadefx::type &t) {
    if (t.base == reshadefx::type::t_string) return quote(v.string_data);
    std::ostringstream o; o.precision(9); o << '[';
    for (unsigned i=0; i<t.rows*t.cols; i++) {
        if(i) o << ',';
        if(t.is_floating_point()) o << (std::isfinite(v.as_float[i]) ? v.as_float[i] : 0);
        else if(t.is_signed()) o << v.as_int[i]; else o << v.as_uint[i];
    }
    o << ']'; return o.str();
}
static std::string annotations(const std::vector<reshadefx::annotation> &a) {
    std::string s="{"; for (const auto &v:a) { if(s.size()>1) s+=","; s+=quote(v.name)+":"+value(v.value,v.type); } return s+"}";
}
int main(int argc,char **argv) {
    if(argc<4) return 2;
    reshadefx::preprocessor pp;
    pp.add_include_path(argv[2]);
    pp.add_include_path(std::filesystem::path(argv[1]).parent_path());
    for(auto pair : {std::pair{"__RESHADE__","40901"},{"__RENDERER__","0x10000"},{"BUFFER_WIDTH","480"},{"BUFFER_HEIGHT","360"},{"BUFFER_RCP_WIDTH","(1.0 / BUFFER_WIDTH)"},{"BUFFER_RCP_HEIGHT","(1.0 / BUFFER_HEIGHT)"},{"BUFFER_COLOR_BIT_DEPTH","8"}}) pp.add_macro_definition(pair.first,pair.second);
    if (argc > 5) { pp.add_macro_definition("BUFFER_WIDTH", argv[4]); pp.add_macro_definition("BUFFER_HEIGHT", argv[5]); }
    if(!pp.append_file(argv[1])) { std::cerr<<pp.errors(); return 1; }
    std::unique_ptr<reshadefx::codegen> cg(reshadefx::create_codegen_glsl(false,false,false));
    reshadefx::parser parser;
    if(!parser.parse(pp.output(),cg.get())) { std::cerr<<parser.errors(); return 1; }
    const auto &m=cg->module();
    std::ofstream out(argv[3]);
    out << "{\"code\":" << quote(cg->finalize_code()) << ",\"uniformSize\":" << m.total_uniform_size << ",\"uniforms\":[";
    bool first=true;
    for(const auto &u:m.uniforms) { if(!first) out<<','; first=false;
        out<<"{\"name\":"<<quote(u.name)<<",\"uniqueName\":"<<quote(u.unique_name)<<",\"offset\":"<<u.offset<<",\"size\":"<<u.size<<",\"type\":"<<quote(u.type.is_floating_point()?"float":u.type.is_unsigned()?"uint":"int")<<",\"rows\":"<<u.type.rows<<",\"cols\":"<<u.type.cols<<",\"value\":"<<value(u.initializer_value,u.type)<<",\"annotations\":"<<annotations(u.annotations)<<'}';
    }
    out<<"],\"textures\":["; first=true;
    for(const auto &t:m.textures) { if(!first) out<<','; first=false;
        out<<"{\"name\":"<<quote(t.unique_name)<<",\"semantic\":"<<quote(t.semantic)<<",\"width\":"<<t.width<<",\"height\":"<<t.height<<",\"levels\":"<<t.levels<<",\"format\":"<<int(t.format)<<",\"annotations\":"<<annotations(t.annotations)<<'}';
    }
    out<<"],\"samplers\":["; first=true;
    for(const auto &s:m.samplers) { if(!first) out<<','; first=false;
        out<<"{\"name\":"<<quote(s.unique_name)<<",\"texture\":"<<quote(s.texture_name)<<",\"filter\":"<<int(s.filter)<<",\"wrapU\":"<<int(s.address_u)<<",\"wrapV\":"<<int(s.address_v)<<",\"srgb\":"<<s.srgb<<'}';
    }
    out<<"],\"entries\":{"; first=true;
    for(const auto &e:m.entry_points) { if(!first) out<<','; first=false;
        std::string code, assembly, errors;
        cg->assemble_code_for_entry_point(e.first,code,assembly,errors);
        out<<quote(e.first)<<":"<<quote(code);
    }
    out<<"},\"techniques\":["; first=true;
    for(const auto &t:m.techniques) { if(!first) out<<','; first=false;
        out<<"{\"name\":"<<quote(t.name)<<",\"annotations\":"<<annotations(t.annotations)<<",\"passes\":["; bool pf=true;
        for(const auto &p:t.passes) { if(!pf) out<<','; pf=false;
            out<<"{\"name\":"<<quote(p.name)<<",\"vertex\":"<<quote(p.vs_entry_point)<<",\"fragment\":"<<quote(p.ps_entry_point)<<",\"compute\":"<<quote(p.cs_entry_point)<<",\"width\":"<<p.viewport_width<<",\"height\":"<<p.viewport_height<<",\"vertices\":"<<p.num_vertices<<",\"clear\":"<<p.clear_render_targets<<",\"mipmaps\":"<<p.generate_mipmaps<<",\"srgb\":"<<p.srgb_write_enable<<",\"blend\":"<<p.blend_enable[0]<<",\"stencil\":"<<p.stencil_enable<<",\"targets\":[";
            // Full fixed-function state is part of the original effect, not an optional approximation.
            bool tf=true; for(const auto &n:p.render_target_names) { if(n.empty()) continue; if(!tf) out<<','; tf=false; out<<quote(n); } out<<"],\"topology\":"<<int(p.topology)<<",\"writeMask\":"<<int(p.render_target_write_mask[0])
                <<",\"srcRGB\":"<<int(p.source_color_blend_factor[0])<<",\"dstRGB\":"<<int(p.dest_color_blend_factor[0])
                <<",\"srcAlpha\":"<<int(p.source_alpha_blend_factor[0])<<",\"dstAlpha\":"<<int(p.dest_alpha_blend_factor[0])
                <<",\"opRGB\":"<<int(p.color_blend_op[0])<<",\"opAlpha\":"<<int(p.alpha_blend_op[0])
                <<",\"stencilReadMask\":"<<int(p.stencil_read_mask)<<",\"stencilWriteMask\":"<<int(p.stencil_write_mask)
                <<",\"stencilRef\":"<<int(p.stencil_reference_value)<<",\"stencilFunc\":"<<int(p.stencil_comparison_func)
                <<",\"stencilPass\":"<<int(p.stencil_pass_op)<<",\"stencilFail\":"<<int(p.stencil_fail_op)
                <<",\"stencilDepthFail\":"<<int(p.stencil_depth_fail_op)<<"}";
        } out<<"]}";
    }
    out<<"]}";
}
